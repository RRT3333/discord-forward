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

export default {
  async email(message, env, ctx) {
    const webhookUrl = env.DISCORD_WEBHOOK_URL;
    const backupForwardTo = env.BACKUP_FORWARD_TO;

    const subject = message.headers.get("subject") || "(No Subject)";
    const fromAddr = message.headers.get("from") || "unknown";
    const toAddr = message.headers.get("to") || "unknown";

    const rawEmail = await new Response(message.raw).text();
    const bodyText = extractEmailBody(rawEmail) || "(본문 없음)";
    const description = truncateForDiscord(bodyText, 4000);

    if (webhookUrl) {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [{
            title: "📩 새 메일 도착",
            description,
            fields: [
              { name: "보낸 사람", value: fromAddr, inline: true },
              { name: "받는 주소", value: toAddr, inline: true },
              { name: "제목", value: subject }
            ],
            color: 3447003,
            timestamp: new Date().toISOString()
          }]
        })
      });
    }

    if (backupForwardTo) {
      await message.forward(backupForwardTo);
    }
  }
}
