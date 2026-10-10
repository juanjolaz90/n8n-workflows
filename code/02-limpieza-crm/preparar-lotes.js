// Nodo Code "Preparar lotes" (Run Once for All Items).
// Lee las filas pendientes de la tabla de propuestas, decide cuáles se aplican y las agrupa
// en lotes de 100 contactos, que es el máximo del endpoint batch/update de HubSpot.

// Excepciones decididas por una persona al revisar la propuesta. Se rellenan en cada limpieza.
const EXCLUIR_SEPARACION = [];   // IDs de contacto donde NO hay que separar nombre y apellido
const MANUAL = {};               // correcciones a mano: { '12345': { firstname: 'Ana María', lastname: 'Pérez' } }
const IGNORAR_FILA = {};         // filas a saltar: { '12345|mobilephone': true }

function aprobar(r) {
  if (String(r.regla).indexOf('FLAG:') === 0) return false; // los avisos nunca se aplican solos
  if (IGNORAR_FILA[r.contact_id + '|' + r.campo]) return false;
  if (r.aprobado === true) return true;
  if (r.regla.indexOf('separa_nombre') >= 0) return EXCLUIR_SEPARACION.indexOf(r.contact_id) < 0;
  if (r.bloque === 'telefono') return true;
  if (r.regla.indexOf('quita_parentesis') >= 0) return true;
  if (r.regla.indexOf('errata_dominio') >= 0) return true;
  return false;
}

const porContacto = {};
const filasPorContacto = {};
for (const it of $input.all()) {
  const r = it.json;
  if (!aprobar(r)) continue;
  if (!porContacto[r.contact_id]) { porContacto[r.contact_id] = {}; filasPorContacto[r.contact_id] = []; }
  porContacto[r.contact_id][r.campo] = r.valor_propuesto === null || r.valor_propuesto === undefined ? '' : r.valor_propuesto;
  filasPorContacto[r.contact_id].push(r.id);
}
for (const id of Object.keys(MANUAL)) {
  if (!porContacto[id]) { porContacto[id] = {}; filasPorContacto[id] = []; }
  Object.assign(porContacto[id], MANUAL[id]);
}

const ids = Object.keys(porContacto);
const lotes = [];
for (let i = 0; i < ids.length; i += 100) {
  const chunk = ids.slice(i, i + 100);
  const inputs = chunk.map(function (id) { return { id: id, properties: porContacto[id] }; });
  let rowIds = [];
  chunk.forEach(function (id) { rowIds = rowIds.concat(filasPorContacto[id]); });
  lotes.push({ json: { body: { inputs: inputs }, rowIds: rowIds, contactos: chunk.length } });
}
return lotes;
