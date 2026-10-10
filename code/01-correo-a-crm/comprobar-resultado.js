// Nodo Code "Comprobar resultado" (Run Once for All Items).
// Resume qué pasó con cada contacto y hace fallar la ejecución si el CRM rechazó alguno,
// para que el error no pase inadvertido. Un 409 (ya existía) no es un error.

const resultados = $input.all().map((item, i) => {
  const origen = $('Validar datos del contacto').itemMatching(i).json;
  const codigo = Number(item.json.statusCode || 0);
  const cuerpo = item.json.body || {};
  let estado = 'error';
  if (codigo === 201 || codigo === 200) estado = 'creado';
  else if (codigo === 409) estado = 'ya existía';
  return {
    json: {
      tipo: origen.tipo || '',
      estado: estado,
      email: origen.propiedades.email,
      hubspotId: cuerpo.id || '',
      derivadoPor: origen.derivadoPor,
      asunto: origen.asunto,
      detalle: estado === 'error' ? (cuerpo.message || JSON.stringify(cuerpo).slice(0, 300)) : ''
    },
    pairedItem: { item: i }
  };
});
const fallos = resultados.filter((r) => r.json.estado === 'error');
if (fallos.length > 0) {
  throw new Error('HubSpot rechazó ' + fallos.length + ' contacto(s): ' + fallos.map((f) => f.json.email + ' → ' + f.json.detalle).join(' | '));
}
return resultados;
