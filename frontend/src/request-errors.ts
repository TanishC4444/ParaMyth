/** Keep service diagnostics in the console, rather than in the writing tools. */
export function requestMessage(detail: unknown, status?: number, fallback = "We couldn't reach your studio. Try again in a moment.") {
  const text = typeof detail === 'string' ? detail.replace(/^Error:\s*/, '') : ''
  if (/MUSE_IMAGE|MODEL_API_KEY|image.*(?:key|provider).*(?:set|missing|unavailable)|set.*image.*key/i.test(text)) return "Image generation isn't available in this studio yet."
  if (/VULTR_MUSIC|music.*provider.*unavailable|instrumental.*unavailable/i.test(text)) return "Music generation isn't available in this studio yet."
  if (/_API_KEY|_INFERENCE_|server environment|Unexpected token|is not valid JSON|Failed to fetch|NetworkError|Load failed|timed out|TimeoutError|operation was aborted|request failed \(\d+\)|not found|^Not Found$/i.test(text)) return fallback
  if (status === 503) return 'This service is unavailable right now. Try again in a moment.'
  if (status === 404 || !text) return fallback
  return text
}
