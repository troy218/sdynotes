// The converter is a deliberately separate hostname, not a second mode of the
// notes application.  Keep this check in the Node process as well as in nginx:
// nginx configurations are often replaced during a migration, while the Host
// check still prevents the converter from appearing on the notes origin.
const DEFAULT_HOSTS = [
  'converter.sdynotes.duckdns.org',
  // Historical name printed in the original request.  Keep it as an alias so
  // either DNS record can be pointed at the same deployment without exposing
  // the converter on sdynotes.duckdns.org itself.
  'latexripper.sdynotes.duckdns.org',
];

function configuredHosts() {
  const raw = process.env.SDY_CONVERTER_HOSTS;
  const values = raw ? raw.split(',') : DEFAULT_HOSTS;
  return new Set(values.map((v) => String(v).trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean));
}

export function requestHostname(req) {
  // Do not use X-Forwarded-Host here.  The deployment preserves the public
  // Host header and trusting a client-supplied forwarded value would defeat the
  // "this hostname only" boundary.
  return String(req.headers?.host || '').split(':')[0].trim().toLowerCase().replace(/\.$/, '');
}

export function isConverterHost(req) {
  return configuredHosts().has(requestHostname(req));
}

export function isConverterPath(url) {
  const path = String(url || '').split('?', 1)[0];
  return path === '/'
    || path === '/converter'
    || path === '/converter.html'
    || path === '/converter.css'
    || path === '/converter.js'
    || path.startsWith('/api/converter/');
}

export function converterNotFound(reply) {
  // A 404, rather than a redirect to SDYnotes, keeps the two origins visibly
  // and operationally independent.
  return reply.code(404).type('text/plain; charset=utf-8').send('Not found');
}
