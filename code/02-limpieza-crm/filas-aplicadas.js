// Nodo Code "Filas aplicadas" (Run Once for All Items).
// Solo los lotes que HubSpot confirma como COMPLETE se marcan como aplicados en la tabla.
// Si un lote falla, sus filas siguen pendientes y se pueden reintentar.

const lotes = $('Preparar lotes').all();
const out = [];
$input.all().forEach(function (it, i) {
  const ok = it.json && it.json.status === 'COMPLETE';
  if (!ok) return;
  (lotes[i].json.rowIds || []).forEach(function (rid) { out.push({ json: { rowId: rid } }); });
});
return out;
