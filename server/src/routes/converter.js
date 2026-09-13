// Standalone PDF → Word surface.  The browser is intentionally tiny: all PDF
// parsing and DOCX formatting happen in the existing Python worker so this route
// cannot drift from the parser used by SDYnotes imports.
import { serveAsset, serveConverterPage } from '../lib/page.js';
import { isConverterHost, converterNotFound } from '../lib/converterAccess.js';

export function registerConverter(app, { worker }) {
  const onlyConverter = (handler) => (req, reply) => {
    if (!isConverterHost(req)) return converterNotFound(reply);
    return handler(req, reply);
  };

  app.get('/converter', onlyConverter(serveConverterPage));
  app.get('/converter.html', onlyConverter(serveConverterPage));
  app.get('/converter.css', onlyConverter((req, reply) => {
    if (!serveAsset(req, reply, '/converter.css')) reply.code(404).send();
  }));
  app.get('/converter.js', onlyConverter((req, reply) => {
    if (!serveAsset(req, reply, '/converter.js')) reply.code(404).send();
  }));

  for (const [method, url] of [
    ['POST', '/api/converter/convert'],
    ['GET', '/api/converter/status'],
    ['GET', '/api/converter/download/:id'],
  ]) {
    app.route({
      method,
      url,
      handler: onlyConverter((req, reply) => worker.proxy(req, reply)),
    });
  }
}
