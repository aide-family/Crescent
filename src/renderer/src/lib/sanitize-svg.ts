import DOMPurify from 'dompurify'

/** Sanitize the generated SVG again at the actual HTML rendering boundary. */
export function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed'],
    ALLOW_UNKNOWN_PROTOCOLS: false
  })
}
