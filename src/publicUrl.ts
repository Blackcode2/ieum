/**
 * Absolute URL of a file in public/. The built app uses relative paths so it can be hosted in a
 * subfolder (GitHub Pages serves it at /<repository>/), which rules out URLs that start with "/".
 */
export function publicUrl(path: string): string {
  return new URL(path.replace(/^\/+/, ''), document.baseURI).href;
}
