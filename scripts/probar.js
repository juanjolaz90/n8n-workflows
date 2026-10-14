// Prueba rápida de los nodos de código con datos inventados, fuera de n8n.
// Uso: node scripts/probar.js
// Simula lo mínimo de n8n ($input y $('Nodo')) para comprobar que la lógica hace lo que dice.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const cargar = (rel) => fs.readFileSync(path.join(__dirname, '..', 'code', rel), 'utf8');
const ejecutar = (rel, items, otros = {}) => {
  const $input = { all: () => items, first: () => items[0] };
  const $ = (nombre) => ({
    all: () => otros[nombre] || [],
    itemMatching: (i) => (otros[nombre] || [])[i],
    item: (otros[nombre] || [])[0],
  });
  return new Function('$input', '$', cargar(rel))($input, $);
};
const ok = (texto) => console.log('  ✓', texto);

console.log('01 · Preparar correo');
{
  const correos = [
    { json: { id: 'a1', subject: 'RE: Propuesta', from: { value: [{ address: 'Marta@Acme.com', name: 'Marta Ruiz' }] },
      to: { value: [{ address: 'contacto@tuempresa.com', name: '' }] }, cc: { value: [{ address: 'luis@acme.com', name: 'Luis Soto' }] },
      text: 'Hola, quien ve esto es Luis, lo dejo en copia.\n\nEl lun, 5 oct 2026 a las 10:00, Ventas escribió:\n> texto antiguo con otro@viejo.com' } },
    { json: { id: 'a2', subject: 'Aviso', from: { value: [{ address: 'no-reply@banco.com', name: '' }] }, text: 'x' } },
    { json: { id: 'a3', subject: 'Interno', from: { value: [{ address: 'ana@tuempresa.com', name: 'Ana' }] }, text: 'x' } },
  ];
  const r = ejecutar('01-correo-a-crm/preparar-correo.js', correos);
  assert.strictEqual(r.length, 1); ok('descarta el correo automático y el interno');
  assert.strictEqual(r[0].json.remitenteEmail, 'marta@acme.com'); ok('normaliza el email del remitente');
  assert.deepStrictEqual(r[0].json.candidatos, ['luis@acme.com']); ok('solo acepta como candidato al email que está en el mensaje nuevo');
  assert.ok(!r[0].json.mensajeNuevo.includes('texto antiguo')); ok('quita el hilo citado');
  assert.strictEqual(r[0].json.esRespuesta, true); ok('detecta que es una respuesta');
}

console.log('01 · Validar datos del contacto');
{
  const preparado = [{ json: { remitenteEmail: 'marta@acme.com', remitenteNombre: 'Marta Ruiz', candidatos: ['luis@acme.com'], asunto: 'RE: Propuesta', gmailId: 'a1' } }];
  const crm = [{ json: { total: 1, results: [{ properties: { company: 'Acme', industry: 'Industria' } }] } }];
  const modelo = [{ json: { output: { tipo: 'derivacion', motivo: 'Deriva a Luis', contactos: [
    { email: 'luis@acme.com', nombre: 'LUIS', apellido: 'soto', telefono: '9 8765 4321', industria: 'Inventada' },
    { email: 'fantasma@otro.com', nombre: 'No', apellido: 'Existe' },
  ] } } }];
  const r = ejecutar('01-correo-a-crm/validar-datos-contacto.js', modelo, { 'Preparar correo': preparado, 'Buscar remitente en HubSpot': crm });
  assert.strictEqual(r.length, 1); ok('descarta el email que el modelo se inventó');
  const p = r[0].json.propiedades;
  assert.strictEqual(p.firstname + ' ' + p.lastname, 'Luis Soto'); ok('corrige mayúsculas del nombre');
  assert.strictEqual(p.phone, '+56987654321'); ok('normaliza el teléfono');
  assert.strictEqual(p.company, 'Acme'); assert.strictEqual(p.industry, 'Industria'); ok('hereda empresa e industria del remitente, que ya está en el CRM');
  assert.strictEqual(p.hs_analytics_source, 'REFERRALS'); ok('marca la fuente como referencia');
}

console.log('02 · Proponer correcciones');
{
  const pagina = [{ json: { results: [
    { id: '1', properties: { firstname: 'JUAN  CARLOS', lastname: 'PEREZ', phone: '987654321', email: 'juan@gmial.com', company: 'n/a' } },
    { id: '2', properties: { firstname: 'Ana Maria Lopez Diaz', lastname: '', mobilephone: '+56 2 2345 6789' } },
    { id: '3', properties: { firstname: 'Comercial Sur Ltda', lastname: '', email: 'info@sur.cl', phone: '11111111' } },
  ] } }];
  const filas = ejecutar('02-limpieza-crm/proponer-correcciones.js', pagina).map((f) => f.json);
  const de = (id, campo) => filas.filter((f) => f.contact_id === id && f.campo === campo);
  assert.strictEqual(de('1', 'firstname')[0].valor_propuesto, 'Juan Carlos'); ok('arregla mayúsculas y espacios');
  assert.strictEqual(de('1', 'phone')[0].valor_propuesto, '+56987654321'); ok('pasa el teléfono a formato internacional');
  assert.strictEqual(de('1', 'email')[0].valor_propuesto, 'juan@gmail.com'); assert.strictEqual(de('1', 'email')[0].aprobado, false); ok('propone la errata del dominio, pero la deja para revisar');
  assert.strictEqual(de('1', 'company')[0].valor_propuesto, ''); ok('vacía una empresa de relleno ("n/a")');
  assert.strictEqual(de('2', 'lastname')[0].valor_propuesto, 'Lopez Diaz'); assert.strictEqual(de('2', 'lastname')[0].revisar, true); ok('separa nombre y apellido, marcado para revisar');
  assert.strictEqual(de('2', 'phone')[0].regla, 'fijo_movido_desde_movil'); ok('mueve un fijo que estaba en el campo de móvil');
  assert.ok(filas.some((f) => f.contact_id === '3' && f.regla === 'FLAG:nombre_parece_empresa')); ok('avisa de un nombre que parece una empresa, sin tocarlo');
  assert.ok(filas.every((f) => f.aplicado === false)); ok('no marca nada como aplicado');

  console.log('02 · Preparar lotes');
  const pendientes = filas.map((f, i) => ({ json: Object.assign({ id: i + 1 }, f) }));
  const lotes = ejecutar('02-limpieza-crm/preparar-lotes.js', pendientes);
  const inputs = lotes[0].json.body.inputs;
  assert.ok(!JSON.stringify(inputs).includes('Comercial Sur')); ok('los avisos FLAG no entran en el lote');
  assert.strictEqual(inputs.find((x) => x.id === '1').properties.firstname, 'Juan Carlos'); ok('agrupa los cambios aprobados por contacto');

  console.log('02 · Filas aplicadas');
  const hechas = ejecutar('02-limpieza-crm/filas-aplicadas.js', [{ json: { status: 'COMPLETE' } }], { 'Preparar lotes': lotes });
  assert.strictEqual(hechas.length, lotes[0].json.rowIds.length); ok('solo marca las filas de los lotes que HubSpot confirma');
  const fallidas = ejecutar('02-limpieza-crm/filas-aplicadas.js', [{ json: { status: 'error' } }], { 'Preparar lotes': lotes });
  assert.strictEqual(fallidas.length, 0); ok('un lote fallido deja sus filas pendientes');
}

console.log('03 · Validar envío del formulario web');
{
  const validar = (body) => ejecutar('03-formulario-web/validar-envio.js', [{ json: { body } }])[0].json;

  const bien = validar({ firstname: '  Ana ', lastname: 'Ruiz', email: 'Ana@Ejemplo.COM', phone: '', message: 'Hola', pagina: 'https://tudominio.com/' });
  assert.strictEqual(bien.valido, true); ok('acepta un envío completo');
  assert.strictEqual(bien.email, 'ana@ejemplo.com'); ok('normaliza el correo a minúsculas');
  assert.ok(!('phone' in bien.propiedades)); ok('no manda al CRM los campos vacíos, para no borrar datos que ya existían');

  const lista = validar({ firstname: 'Luis', lastname: 'Soto', email: 'luis@ejemplo.com', tipo: 'lista_espera' });
  assert.ok(lista.propiedades.message.startsWith('Lista de espera')); ok('marca en el mensaje a quien se apunta a la lista de espera');

  assert.strictEqual(validar({ firstname: 'a', lastname: 'b', email: 'a@b.co', empresa_web: 'x' }).motivo, 'trampa'); ok('rechaza a los robots que rellenan el campo trampa');
  assert.strictEqual(validar({ firstname: 'Ana', email: 'ana@ejemplo.com' }).motivo, 'faltan_datos'); ok('rechaza un envío sin apellido');
  assert.strictEqual(validar({ firstname: 'Ana', lastname: 'Ruiz', email: 'sin-arroba' }).motivo, 'correo_invalido'); ok('rechaza un correo inválido');
  assert.strictEqual(validar({}).valido, false); ok('un cuerpo vacío no rompe el nodo');
}

console.log('\nTodo correcto.');
