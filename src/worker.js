function decodeQuotedPrintable(input) {
  const softBreaksRemoved = input.replace(/=\r?\n/g, "");
  return softBreaksRemoved.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
}

function decodeBase64ToString(input, charset) {
  const cleaned = input.replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  try {
    return new TextDecoder(charset || "utf-8", { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function stripHtml(html) {
  const withBreaks = html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n")
    .replace(/<\s*p\s*>/gi, "\n");
  const noTags = withBreaks.replace(/<[^>]+>/g, "");
  return noTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .trim();
}

function parseHeaders(rawHeaders) {
  const headers = new Map();
  const lines = rawHeaders.split(/\r?\n/);
  let currentKey = null;
  for (const line of lines) {
    if (!line) continue;
    if (/^\s/.test(line) && currentKey) {
      headers.set(currentKey, headers.get(currentKey) + " " + line.trim());
      continue;
    }
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    currentKey = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers.set(currentKey, value);
  }
  return headers;
}

function getContentTypeParam(contentType, name) {
  if (!contentType) return null;
  const match = contentType.match(new RegExp(`${name}="?([^";]+)"?`, "i"));
  return match ? match[1] : null;
}

function decodeBody(body, headers) {
  const transferEncoding = (headers.get("content-transfer-encoding") || "").toLowerCase();
  const contentType = headers.get("content-type") || "";
  const charset = getContentTypeParam(contentType, "charset");

  if (transferEncoding === "base64") {
    return decodeBase64ToString(body, charset);
  }
  if (transferEncoding === "quoted-printable") {
    const decoded = decodeQuotedPrintable(body);
    try {
      return new TextDecoder(charset || "utf-8", { fatal: false }).decode(
        new TextEncoder().encode(decoded)
      );
    } catch {
      return decoded;
    }
  }
  return body;
}

function extractTextFromMultipart(body, boundary) {
  const delimiter = `--${boundary}`;
  const parts = body.split(delimiter).slice(1, -1);
  let plainText = "";
  let htmlText = "";

  for (const part of parts) {
    const trimmed = part.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    const splitIndex = trimmed.search(/\r?\n\r?\n/);
    if (splitIndex === -1) continue;
    const rawHeaders = trimmed.slice(0, splitIndex);
    const rawBody = trimmed.slice(splitIndex + trimmed.match(/\r?\n\r?\n/)[0].length);
    const headers = parseHeaders(rawHeaders);
    const contentType = (headers.get("content-type") || "").toLowerCase();
    const decodedBody = decodeBody(rawBody, headers);

    if (contentType.startsWith("text/plain")) {
      plainText = decodedBody.trim();
    } else if (contentType.startsWith("text/html")) {
      htmlText = decodedBody.trim();
    }
  }

  if (plainText) return plainText;
  if (htmlText) return stripHtml(htmlText);
  return "";
}

function extractEmailBody(rawEmail) {
  const splitIndex = rawEmail.search(/\r?\n\r?\n/);
  if (splitIndex === -1) return rawEmail.trim();
  const rawHeaders = rawEmail.slice(0, splitIndex);
  const body = rawEmail.slice(splitIndex + rawEmail.match(/\r?\n\r?\n/)[0].length);
  const headers = parseHeaders(rawHeaders);
  const contentType = headers.get("content-type") || "";
  const boundary = getContentTypeParam(contentType, "boundary");

  if (contentType.toLowerCase().startsWith("multipart/") && boundary) {
    return extractTextFromMultipart(body, boundary);
  }

  const decoded = decodeBody(body, headers);
  if (contentType.toLowerCase().startsWith("text/html")) {
    return stripHtml(decoded);
  }
  return decoded.trim();
}

function truncateForDiscord(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 3)) + "...";
}

function splitIntoChunks(text, maxLength) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(cursor + maxLength, text.length);
    if (end < text.length) {
      const lastBreak = Math.max(
        text.lastIndexOf("\n", end),
        text.lastIndexOf(" ", end)
      );
      if (lastBreak > cursor + Math.floor(maxLength * 0.6)) {
        end = lastBreak;
      }
    }
    chunks.push(text.slice(cursor, end).trim());
    cursor = end;
  }

  return chunks.filter(Boolean);
}

async function postDiscordJson(webhookUrl, payload) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Discord webhook failed: ${response.status} ${responseText}`);
  }
}

async function postDiscordWithAttachment(webhookUrl, payload, filename, content) {
  const formData = new FormData();
  formData.append("payload_json", JSON.stringify(payload));
  formData.append(
    "files[0]",
    new Blob([content], { type: "text/plain; charset=utf-8" }),
    filename
  );

  const response = await fetch(webhookUrl, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Discord attachment upload failed: ${response.status} ${responseText}`);
  }
}

async function postMetadataEmbed(webhookUrl, meta, extraFields = []) {
  await postDiscordJson(webhookUrl, {
    embeds: [{
      title: "📩 새 메일 도착",
      fields: [
        { name: "보낸 사람", value: meta.fromAddr, inline: true },
        { name: "받는 주소", value: meta.toAddr, inline: true },
        { name: "제목", value: meta.subject },
        ...extraFields
      ],
      color: 3447003,
      timestamp: new Date().toISOString()
    }]
  });
}

async function sendEmailToDiscord(webhookUrl, meta) {
  const EMBED_LIMIT = 4000;
  const CHUNK_LIMIT = 3800;
  const SPLIT_THRESHOLD = 12000;

  if (meta.bodyText.length <= EMBED_LIMIT) {
    await postMetadataEmbed(webhookUrl, meta);
    await postDiscordJson(webhookUrl, {
      embeds: [{
        title: "📄 메일 본문",
        description: meta.bodyText,
        color: 3447003,
        timestamp: new Date().toISOString()
      }]
    });
    return;
  }

  if (meta.bodyText.length <= SPLIT_THRESHOLD) {
    const chunks = splitIntoChunks(meta.bodyText, CHUNK_LIMIT);
    await postMetadataEmbed(webhookUrl, meta, [{ name: "전송 방식", value: `분할 전송 (${chunks.length}개)` }]);

    for (let i = 0; i < chunks.length; i += 1) {
      await postDiscordJson(webhookUrl, {
        embeds: [{
          title: "📄 메일 본문",
          description: chunks[i],
          fields: [{ name: "본문 분할", value: `${i + 1}/${chunks.length}` }],
          color: 3447003,
          timestamp: new Date().toISOString()
        }]
      });
    }
    return;
  }

  const summary = truncateForDiscord(meta.bodyText, 500);
  const safeSubject = meta.subject.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "mail";
  const filename = `mail-${safeSubject}-${Date.now()}.txt`;

  await postMetadataEmbed(webhookUrl, meta, [{ name: "전송 방식", value: "요약 + TXT 첨부" }]);

  await postDiscordWithAttachment(
    webhookUrl,
    {
      content: "본문이 길어 요약 + 첨부파일로 전송합니다.",
      embeds: [{
        title: "📄 메일 본문 요약",
        description: summary,
        color: 3447003,
        timestamp: new Date().toISOString()
      }]
    },
    filename,
    meta.bodyText
  );
}

export default {
  async email(message, env, ctx) {
    const webhookUrl = env.DISCORD_WEBHOOK_URL;
    const backupForwardTo = env.BACKUP_FORWARD_TO;

    const subject = message.headers.get("subject") || "(No Subject)";
    const fromAddr = message.headers.get("from") || "unknown";
    const toAddr = message.headers.get("to") || "unknown";

    const rawEmail = await new Response(message.raw).text();
    const bodyText = extractEmailBody(rawEmail) || "(본문 없음)";

    if (webhookUrl) {
      await sendEmailToDiscord(webhookUrl, {
        subject,
        fromAddr,
        toAddr,
        bodyText
      });
    }

    if (backupForwardTo) {
      await message.forward(backupForwardTo);
    }
  }
}
