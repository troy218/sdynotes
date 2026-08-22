// Cloudinary helper (upload/destroy + signed download URL for raw assets).
import { v2 as cloudinary } from 'cloudinary';
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } from './config.js';

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
  ...(process.env.CLOUDINARY_UPLOAD_PREFIX ? { upload_prefix: process.env.CLOUDINARY_UPLOAD_PREFIX } : {}),
});

export { cloudinary };

export function uploadImage(filePathOrDataUrl, opts) {
  return cloudinary.uploader.upload(filePathOrDataUrl, opts);
}

export function uploadStream(buffer, opts) {
  return new Promise((resolve, reject) => {
    const st = cloudinary.uploader.upload_stream(opts, (err, res) => (err ? reject(err) : resolve(res)));
    st.end(buffer);
  });
}

export function destroy(publicId, opts = {}) {
  return cloudinary.uploader.destroy(publicId, opts);
}

export function cloudinaryUrl(publicId, opts = {}) {
  return cloudinary.url(publicId, opts);
}

export function cldDlUrl(rec) {
  // signed download URL for raw (PDF/ZIP) assets; filename URL-encoded
  const rawName = rec.name || 'download';
  let base = String(rawName).split(/[\\/]/).pop().replace(/[,\\/]/g, '_');
  const dlName = encodeURIComponent(base);
  const kind = rec.resource_type || 'raw';
  const opts = {
    resource_type: kind,
    type: 'upload',
    secure: true,
    flags: `attachment:${dlName}`,
  };
  if (kind === 'raw') opts.sign_url = true;
  if (rec.version) opts.version = rec.version;
  return cloudinary.url(rec.public_id, opts);
}
