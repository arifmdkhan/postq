export async function serveMedia(bucket: R2Bucket, key: string, request: Request, headers: Headers, bytes: number) {
  const range = request.method === "GET" ? request.headers.get("range") : null;
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  const start = match?.[1] ? Number(match[1]) : Math.max(0, bytes - Number(match?.[2]));
  const end = match?.[1] && match[2] ? Math.min(bytes - 1, Number(match[2])) : bytes - 1;
  if (range && (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end)) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${bytes}` } });
  }
  headers.set("accept-ranges", "bytes");
  if (request.method === "HEAD") {
    const object = await bucket.head(key);
    if (!object) return new Response(null, { status: 404 });
    headers.set("content-length", String(object.size));
    return new Response(null, { headers });
  }
  const length = end - start + 1;
  const object = await bucket.get(key, range ? { range: { offset: start, length } } : undefined);
  if (!object) return new Response(null, { status: 404 });
  headers.set("content-length", String(range ? length : object.size));
  if (range) headers.set("content-range", `bytes ${start}-${end}/${bytes}`);
  return new Response(object.body, { status: range ? 206 : 200, headers });
}
