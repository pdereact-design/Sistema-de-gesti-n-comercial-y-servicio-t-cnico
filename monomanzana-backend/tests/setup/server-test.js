// Levanta una instancia de la app y helpers para requests HTTP en pruebas.
// crearServidor() devuelve una instancia fresca con su propio puerto.

const http = require('http');
const jwt  = require('jsonwebtoken');
require('dotenv').config();

function tokenPara(usuario) {
  return jwt.sign(
    { id: usuario.id, email: usuario.email, rol: usuario.rol },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// Helper de request HTTP. Recibe baseUrl como argumento para ser stateless.
function request(baseUrl, method, ruta, body, token) {
  if (!baseUrl) throw new Error('baseUrl no está definida. El servidor no fue iniciado.');
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url     = new URL(baseUrl + ruta);
    const options = {
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname,
      method,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': payload ? Buffer.byteLength(payload) : 0,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Levanta un servidor Express en un puerto libre.
// Devuelve { baseUrl, cerrar } para que cada suite limpie la suya.
async function crearServidor(app) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(app);
    srv.listen(0, '127.0.0.1', () => {
      const puerto = srv.address().port;
      const baseUrl = `http://127.0.0.1:${puerto}`;
      resolve({
        baseUrl,
        cerrar: () => new Promise((res, rej) => srv.close(err => err ? rej(err) : res())),
      });
    });
    srv.on('error', reject);
  });
}

module.exports = { crearServidor, request, tokenPara };
