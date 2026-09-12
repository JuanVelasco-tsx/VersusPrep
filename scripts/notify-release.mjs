// scripts/notify-release.mjs
//
// Notificacion best-effort a Discord al terminar un build de release.
// Se ejecuta al final del script "release" (ver package.json).
//
// Requisitos:
//   - Node 18+ (usa fetch nativo).
//   - Variable de entorno RELEASE_WEBHOOK_SECRET con el secreto del webhook.
//
// Comportamiento:
//   - Si RELEASE_WEBHOOK_SECRET no esta definida: warning y salida limpia (exit 0).
//   - Si el POST falla (red, 401, etc.): se registra el error pero NO se aborta
//     el proceso (la notificacion es best-effort; el build ya se completo).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const WEBHOOK_URL = 'https://eito-bot-dc-production.up.railway.app/release-webhook';

async function main() {
  // Leer version y productName/name desde el package.json del proyecto.
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(here, '..', 'package.json');

  let pkg;
  try {
    pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  } catch (err) {
    console.error(`[notify-release] No se pudo leer package.json en ${pkgPath}:`, err?.message ?? err);
    // No abortamos el build por esto: la notificacion es best-effort.
    return;
  }

  const version = pkg.version;
  const productName = pkg.productName ?? pkg.name ?? 'app';

  const secret = process.env.RELEASE_WEBHOOK_SECRET;
  if (!secret) {
    console.warn(
      '[notify-release] ADVERTENCIA: la variable de entorno RELEASE_WEBHOOK_SECRET no esta definida.\n' +
      '                 Se omite la notificacion a Discord. El build NO se ve afectado.\n' +
      '                 Define RELEASE_WEBHOOK_SECRET para habilitar la notificacion.'
    );
    return; // exit 0
  }

  const body = {
    version,
    changelog: 'Nueva version en fase de pruebas en entorno de desarrollo.',
  };

  // Timeout duro para que un webhook colgado (sin responder ni rechazar) no
  // deje el `await fetch` esperando indefinidamente y cuelgue el `release`
  // completo en su ultimo paso. AbortController aborta la request a los 8s.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(
        `[notify-release] El webhook respondio con estado ${res.status} ${res.statusText}. ` +
        `${text ? `Respuesta: ${text}` : ''}`.trim()
      );
      return; // best-effort: no abortamos
    }

    console.log(`[notify-release] Notificacion enviada correctamente para ${productName} v${version}.`);
  } catch (err) {
    if (err?.name === 'AbortError') {
      console.error(
        '[notify-release] La notificacion se aborto por timeout (el webhook no respondio en 8s). ' +
        'El build NO se ve afectado.'
      );
    } else {
      console.error('[notify-release] Fallo la notificacion al webhook:', err?.message ?? err);
    }
    // best-effort: no abortamos
  } finally {
    clearTimeout(timeout);
  }
}

// Nunca dejamos que un error propague un exit code distinto de 0.
main().catch((err) => {
  console.error('[notify-release] Error inesperado (ignorado, build no afectado):', err?.message ?? err);
});
