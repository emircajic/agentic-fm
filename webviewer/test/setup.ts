/**
 * Vitest setup — provide a spec-compliant XML DOM in Node.
 *
 * The converters call `new DOMParser().parseFromString(xml, 'text/xml')`, which
 * exists natively in the browser but not in Node. jsdom's DOMParser parses XML
 * exactly as the browser does — case-preserving tags, XML entity decoding in
 * attributes (`&lt;` → `<`), CDATA in textContent, direct-child `.children`, and
 * `querySelector` child combinators — so a test PASS means the real browser
 * runtime produces the same bytes. (linkedom does NOT decode attribute entities,
 * and happy-dom/jsdom-HTML uppercase tags; only jsdom's XML mode is faithful.)
 */
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('', { contentType: 'text/html' });
(globalThis as unknown as { DOMParser: unknown }).DOMParser = window.DOMParser;
