// Nodo Code "Validar envío" (Run Once for All Items).
// Limpia y valida lo que manda el formulario de la web. Siempre devuelve un único item,
// con "valido" a true o false, para que el If siguiente decida qué contestar.

const ETIQUETA_LISTA = 'Lista de espera'; // texto que identifica en el CRM a quien se apunta a la lista

const cuerpo = $input.first().json.body || {};
const limpiar = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

const firstname = limpiar(cuerpo.firstname, 80);
const lastname = limpiar(cuerpo.lastname, 80);
const email = limpiar(cuerpo.email, 160).toLowerCase();
const phone = limpiar(cuerpo.phone, 40);
const tipo = cuerpo.tipo === 'lista_espera' ? 'lista_espera' : 'contacto';

let message = String(cuerpo.message == null ? '' : cuerpo.message).trim().slice(0, 3000);
if (tipo === 'lista_espera') {
  message = ETIQUETA_LISTA + (message ? ' — ' + message : '');
}

// "empresa_web" es un campo trampa oculto: una persona nunca lo rellena.
let motivo = '';
if (limpiar(cuerpo.empresa_web, 50)) motivo = 'trampa';
else if (!firstname || !lastname) motivo = 'faltan_datos';
else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) motivo = 'correo_invalido';

// Solo las propiedades con valor: así un campo vacío no borra un dato que ya estaba en el CRM.
const propiedades = { email: email, firstname: firstname, lastname: lastname };
if (phone) propiedades.phone = phone;
if (message) propiedades.message = message;

return [{
  json: {
    valido: motivo === '',
    motivo: motivo,
    tipo: tipo,
    firstname: firstname,
    lastname: lastname,
    email: email,
    phone: phone,
    message: message,
    pagina: limpiar(cuerpo.pagina, 300),
    fecha: new Date().toISOString(),
    propiedades: propiedades
  }
}];
