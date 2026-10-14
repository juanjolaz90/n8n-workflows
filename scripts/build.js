// Genera los JSON importables de /workflows a partir del código legible de /code.
// Uso: node scripts/build.js
// Así el código de cada nodo se puede leer y revisar como archivo normal, y el JSON
// que importa n8n siempre coincide con él.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(root, 'code', rel), 'utf8').replace(/\r\n/g, '\n');
const guardar = (nombre, wf) => {
  const destino = path.join(root, 'workflows', nombre);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, JSON.stringify(wf, null, 2) + '\n');
  console.log('✓', nombre, '(' + wf.nodes.length + ' nodos)');
};
const nota = (id, contenido, posicion, alto, ancho) => ({
  parameters: { content: contenido, height: alto, width: ancho, color: 4 },
  id, name: 'Nota', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: posicion,
});
const TABLA = { __rl: true, mode: 'id', value: 'REEMPLAZAR_ID_DATA_TABLE' };

// ───────────────────────── 01 · Correo → CRM ─────────────────────────
const esquema = {
  type: 'object',
  properties: {
    tipo: { type: 'string', enum: ['derivacion', 'solicitud_directa', 'otro'], description: 'Clasificación del correo' },
    motivo: { type: 'string', description: 'Frase corta con el porqué' },
    remitente: {
      type: 'object',
      description: 'Datos del remitente (solo si tipo = solicitud_directa)',
      properties: {
        nombre: { type: 'string' }, apellido: { type: 'string' }, cargo: { type: 'string' },
        empresa: { type: 'string' }, industria: { type: 'string' }, telefono: { type: 'string' },
      },
    },
    contactos: {
      type: 'array',
      description: 'Personas derivadas (solo si tipo = derivacion)',
      items: {
        type: 'object',
        properties: {
          email: { type: 'string' }, nombre: { type: 'string' }, apellido: { type: 'string' }, cargo: { type: 'string' },
          empresa: { type: 'string' }, industria: { type: 'string' }, telefono: { type: 'string' },
        },
        required: ['email'],
      },
    },
  },
  required: ['tipo', 'motivo', 'contactos'],
};

guardar('01-correo-a-crm.json', {
  name: 'Correo comercial → CRM (clasificación con IA)',
  nodes: [
    nota('nota-01',
      '## Correo comercial → CRM\n\n' +
      '1. Una vez al día lee el buzón comercial (hasta 100 correos).\n' +
      '2. Descarta correos internos y automáticos; quita el hilo citado.\n' +
      '3. El modelo clasifica: derivación, solicitud directa u otro.\n' +
      '4. **Derivación** → crea a la persona derivada (solo emails que aparecen en el correo). Fuente = Referencias.\n' +
      '5. **Solicitud directa** → crea al remitente con los datos de su firma. Fuente = Tráfico directo.\n' +
      '6. Si el contacto ya existe en el CRM, no se toca nada.\n\n' +
      '**Antes de activar:** conecta las credenciales de Gmail, HubSpot (token de app privada) y Anthropic, ' +
      'y cambia `tuempresa.com` en el disparador, en "Preparar correo" y en el prompt.',
      [-32, -272], 380, 540),
    {
      parameters: {
        pollTimes: { item: [{ mode: 'everyDay', hour: 19, minute: 0 }] },
        simple: false,
        maxResults: 100,
        filters: {
          includeSpamTrash: false,
          q: 'in:inbox -from:tuempresa.com -category:promotions -category:social -category:updates',
          readStatus: 'both',
        },
        options: { downloadAttachments: false },
      },
      id: 'gmail-trigger', name: 'Nuevo correo en el buzón comercial',
      type: 'n8n-nodes-base.gmailTrigger', typeVersion: 1.4, position: [0, 304],
    },
    {
      parameters: { jsCode: leer('01-correo-a-crm/preparar-correo.js') },
      id: 'preparar-correo', name: 'Preparar correo',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [240, 304],
    },
    {
      parameters: {
        method: 'POST',
        url: 'https://api.hubapi.com/crm/v3/objects/contacts/search',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpBearerAuth',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ { "filterGroups": [{ "filters": [{ "propertyName": "email", "operator": "EQ", "value": $json.remitenteEmail }] }], "properties": ["company", "industry"], "limit": 1 } }}',
        options: { timeout: 10000 },
      },
      id: 'buscar-remitente', name: 'Buscar remitente en HubSpot',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.5, position: [480, 304],
      onError: 'continueRegularOutput',
    },
    {
      parameters: {
        text: "={{ $('Preparar correo').item.json.textoParaIA }}",
        schemaType: 'manual',
        inputSchema: JSON.stringify(esquema),
        options: { systemPromptTemplate: leer('01-correo-a-crm/prompt-clasificador.md') },
      },
      id: 'clasificar', name: 'Clasificar correo con Claude',
      type: '@n8n/n8n-nodes-langchain.informationExtractor', typeVersion: 1.2, position: [720, 304],
    },
    {
      parameters: {
        model: { __rl: true, mode: 'id', value: 'claude-haiku-4-5-20251001' },
        options: { maxTokensToSample: 1024, temperature: 0 },
      },
      id: 'modelo', name: 'Claude Haiku',
      type: '@n8n/n8n-nodes-langchain.lmChatAnthropic', typeVersion: 1.6, position: [720, 528],
    },
    {
      parameters: { jsCode: leer('01-correo-a-crm/validar-datos-contacto.js') },
      id: 'validar', name: 'Validar datos del contacto',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [1008, 304],
    },
    {
      parameters: {
        method: 'POST',
        url: 'https://api.hubapi.com/crm/v3/objects/contacts',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpBearerAuth',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ { "properties": $json.propiedades } }}',
        options: { response: { response: { fullResponse: true, neverError: true } }, timeout: 10000 },
      },
      id: 'crear-contacto', name: 'Crear contacto en HubSpot',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.5, position: [1248, 304],
    },
    {
      parameters: { jsCode: leer('01-correo-a-crm/comprobar-resultado.js') },
      id: 'comprobar', name: 'Comprobar resultado',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [1488, 304],
    },
  ],
  connections: {
    'Nuevo correo en el buzón comercial': { main: [[{ node: 'Preparar correo', type: 'main', index: 0 }]] },
    'Preparar correo': { main: [[{ node: 'Buscar remitente en HubSpot', type: 'main', index: 0 }]] },
    'Buscar remitente en HubSpot': { main: [[{ node: 'Clasificar correo con Claude', type: 'main', index: 0 }]] },
    'Claude Haiku': { ai_languageModel: [[{ node: 'Clasificar correo con Claude', type: 'ai_languageModel', index: 0 }]] },
    'Clasificar correo con Claude': { main: [[{ node: 'Validar datos del contacto', type: 'main', index: 0 }]] },
    'Validar datos del contacto': { main: [[{ node: 'Crear contacto en HubSpot', type: 'main', index: 0 }]] },
    'Crear contacto en HubSpot': { main: [[{ node: 'Comprobar resultado', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
});

// ───────────────────────── 02a · Limpieza: proponer ─────────────────────────
guardar('02a-limpieza-crm-proponer.json', {
  name: 'Limpieza de contactos · 1 Proponer',
  nodes: [
    nota('nota-02a',
      '## Limpieza de contactos · 1 Proponer\n\n' +
      'Lee todos los contactos de HubSpot y escribe en una Data Table las correcciones propuestas ' +
      '(nombres, teléfonos, email, empresa, país). **No modifica HubSpot.**\n\n' +
      'Revisa la tabla, marca `aprobado` en lo que quieras aplicar y ejecuta después el flujo "2 Aplicar".\n\n' +
      '**Antes de ejecutar:** crea la Data Table (columnas en el README), pon su ID en "Guardar propuesta", ' +
      'conecta la credencial de HubSpot y cambia `TU_PORTAL_ID` en el código.',
      [-32, -336], 300, 520),
    {
      parameters: {},
      id: 'disparo-02a', name: 'Ejecutar análisis',
      type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0],
    },
    {
      parameters: {
        method: 'GET',
        url: 'https://api.hubapi.com/crm/v3/objects/contacts',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpBearerAuth',
        sendQuery: true,
        specifyQuery: 'keypair',
        queryParameters: {
          parameters: [
            { name: 'limit', value: '100' },
            { name: 'archived', value: 'false' },
            { name: 'properties', value: 'firstname,lastname,email,phone,mobilephone,company,country,hs_lead_status,hs_email_hard_bounce_reason_enum' },
          ],
        },
        options: {
          pagination: {
            pagination: {
              paginationMode: 'updateAParameterInEachRequest',
              parameters: { parameters: [{ type: 'qs', name: 'after', value: '={{ $response.body.paging.next.after }}' }] },
              paginationCompleteWhen: 'other',
              completeExpression: '={{ $response.body.paging === undefined }}',
              limitPagesFetched: true,
              maxRequests: 60,
              requestInterval: 150,
            },
          },
        },
      },
      id: 'leer-contactos', name: 'Leer contactos HubSpot',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.5, position: [224, 0],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: leer('02-limpieza-crm/proponer-correcciones.js') },
      id: 'proponer', name: 'Proponer correcciones',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [448, 0],
    },
    {
      parameters: {
        resource: 'row', operation: 'insert', dataTableId: TABLA,
        columns: { mappingMode: 'autoMapInputData', value: null },
        options: { optimizeBulk: true },
      },
      id: 'guardar-propuesta', name: 'Guardar propuesta',
      type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [672, 0],
    },
  ],
  connections: {
    'Ejecutar análisis': { main: [[{ node: 'Leer contactos HubSpot', type: 'main', index: 0 }]] },
    'Leer contactos HubSpot': { main: [[{ node: 'Proponer correcciones', type: 'main', index: 0 }]] },
    'Proponer correcciones': { main: [[{ node: 'Guardar propuesta', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
});

// ───────────────────────── 02b · Limpieza: aplicar ─────────────────────────
guardar('02b-limpieza-crm-aplicar.json', {
  name: 'Limpieza de contactos · 2 Aplicar',
  nodes: [
    nota('nota-02b',
      '## Limpieza de contactos · 2 Aplicar\n\n' +
      'Aplica en HubSpot (batch update, lotes de 100) las filas aprobadas de la Data Table y las marca ' +
      'como aplicadas. La columna `valor_actual` queda como respaldo para revertir.\n\n' +
      'Los avisos `FLAG:` nunca se aplican solos. Las excepciones revisadas a mano se anotan en "Preparar lotes".',
      [-32, -288], 250, 520),
    {
      parameters: {},
      id: 'disparo-02b', name: 'Aplicar cambios',
      type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0],
    },
    {
      parameters: {
        resource: 'row', operation: 'get', dataTableId: TABLA,
        matchType: 'allConditions',
        filters: { conditions: [{ keyName: 'aplicado', condition: 'isFalse' }] },
        returnAll: true,
      },
      id: 'leer-propuesta', name: 'Leer propuesta pendiente',
      type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [224, 0],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: leer('02-limpieza-crm/preparar-lotes.js') },
      id: 'preparar-lotes', name: 'Preparar lotes',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [448, 0],
    },
    {
      parameters: {
        method: 'POST',
        url: 'https://api.hubapi.com/crm/v3/objects/contacts/batch/update',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpBearerAuth',
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.body) }}',
        options: { batching: { batch: { batchSize: 1, batchInterval: 400 } } },
      },
      id: 'actualizar-hubspot', name: 'Actualizar HubSpot (batch)',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.5, position: [672, 0],
      retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: leer('02-limpieza-crm/filas-aplicadas.js') },
      id: 'filas-aplicadas', name: 'Filas aplicadas',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [896, 0],
    },
    {
      parameters: {
        resource: 'row', operation: 'update', dataTableId: TABLA,
        matchType: 'allConditions',
        filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: '={{ $json.rowId }}' }] },
        columns: {
          mappingMode: 'defineBelow',
          value: { aplicado: true },
          schema: [{ id: 'aplicado', displayName: 'aplicado', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true }],
        },
      },
      id: 'marcar-aplicado', name: 'Marcar como aplicado',
      type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [1120, 0],
    },
  ],
  connections: {
    'Aplicar cambios': { main: [[{ node: 'Leer propuesta pendiente', type: 'main', index: 0 }]] },
    'Leer propuesta pendiente': { main: [[{ node: 'Preparar lotes', type: 'main', index: 0 }]] },
    'Preparar lotes': { main: [[{ node: 'Actualizar HubSpot (batch)', type: 'main', index: 0 }]] },
    'Actualizar HubSpot (batch)': { main: [[{ node: 'Filas aplicadas', type: 'main', index: 0 }]] },
    'Filas aplicadas': { main: [[{ node: 'Marcar como aplicado', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
});

// ───────────────────── 03 · Formulario web → CRM ─────────────────────
const V = (campo) => `$("Validar envío").item.json.${campo}`;
const columna = (id) => ({ id, displayName: id, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true });

guardar('03-formulario-web-a-crm.json', {
  name: 'Formulario web → CRM (sin el filtro de spam de HubSpot)',
  nodes: [
    nota('nota-03',
      '## Formulario web → CRM\n\n' +
      'Recibe el formulario de tu web (contacto o lista de espera) y crea el contacto en HubSpot.\n\n' +
      '1. Valida los datos y descarta robots (campo trampa `empresa_web`).\n' +
      '2. Guarda el envío en una Data Table: si HubSpot falla, no se pierde.\n' +
      '3. Crea o actualiza el contacto en HubSpot por la API de CRM (upsert por email).\n' +
      '4. Responde a la web y avisa por correo.\n\n' +
      '**Antes de activar:** cambia el dominio en "Allowed Origins" del Webhook, crea la Data Table ' +
      '(columnas en el README) y pon su ID, conecta HubSpot (Bearer con un token de app privada con ' +
      '`crm.objects.contacts.write`) y Gmail, y cambia `tu@correo.com`.',
      [-32, -352], 360, 560),
    {
      parameters: {
        httpMethod: 'POST', path: 'contacto-web', authentication: 'none', responseMode: 'responseNode',
        options: { allowedOrigins: 'https://tudominio.com' },
      },
      id: 'webhook-03', name: 'Formulario de la web',
      type: 'n8n-nodes-base.webhook', typeVersion: 2.1, position: [0, 96],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: leer('03-formulario-web/validar-envio.js') },
      id: 'validar-03', name: 'Validar envío',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [272, 224],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ leftValue: '={{ $json.valido }}', operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
          combinator: 'and',
        },
      },
      id: 'si-valido-03', name: '¿Envío válido?',
      type: 'n8n-nodes-base.if', typeVersion: 2.3, position: [496, 224],
    },
    {
      parameters: {
        resource: 'row', operation: 'insert', dataTableId: TABLA,
        columns: {
          mappingMode: 'defineBelow',
          value: {
            fecha: `={{ ${V('fecha')} }}`, tipo: `={{ ${V('tipo')} }}`, nombre: `={{ ${V('firstname')} }}`,
            apellido: `={{ ${V('lastname')} }}`, correo: `={{ ${V('email')} }}`, telefono: `={{ ${V('phone')} }}`,
            mensaje: `={{ ${V('message')} }}`, pagina: `={{ ${V('pagina')} }}`,
          },
          schema: ['fecha', 'tipo', 'nombre', 'apellido', 'correo', 'telefono', 'mensaje', 'pagina'].map(columna),
        },
      },
      id: 'guardar-03', name: 'Guardar envío',
      type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [800, 320],
    },
    {
      parameters: {
        method: 'POST',
        url: 'https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpBearerAuth',
        sendBody: true, contentType: 'json', specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ inputs: [{ idProperty: "email", id: ${V('email')}, properties: ${V('propiedades')} }] }) }}`,
        options: { response: { response: { fullResponse: true, neverError: true } }, timeout: 10000 },
      },
      id: 'hubspot-03', name: 'Crear o actualizar contacto en HubSpot',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.5, position: [1024, 320],
      onError: 'continueRegularOutput',
    },
    {
      parameters: { respondWith: 'json', responseBody: '{ "ok": true }', options: { responseCode: 200 } },
      id: 'responder-ok-03', name: 'Responder a la web: recibido',
      type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.5, position: [1328, 320],
    },
    {
      parameters: {
        resource: 'message', operation: 'send', sendTo: 'tu@correo.com',
        subject: `={{ (${V('tipo')} === "lista_espera" ? "Lista de espera" : "Contacto web") + ": " + ${V('firstname')} + " " + ${V('lastname')} }}`,
        emailType: 'text',
        message: `={{ "Nuevo envío desde la web (" + ${V('tipo')} + ")\n\nNombre: " + ${V('firstname')} + " " + ${V('lastname')} + "\nCorreo: " + ${V('email')} + "\nTeléfono: " + (${V('phone')} || "(no indicó)") + "\nPágina: " + ${V('pagina')} + "\n\nMensaje:\n" + (${V('message')} || "(sin mensaje)") + "\n\nHubSpot: " + ([200, 201, 207].includes($("Crear o actualizar contacto en HubSpot").item.json.statusCode) ? "contacto creado o actualizado" : "NO se pudo guardar el contacto (código " + $("Crear o actualizar contacto en HubSpot").item.json.statusCode + "). Los datos están en la Data Table.") }}`,
        options: { appendAttribution: false, replyTo: `={{ ${V('email')} }}` },
      },
      id: 'avisar-03', name: 'Avisar por correo',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.2, position: [1552, 320],
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: `={{ JSON.stringify({ ok: false, motivo: ${V('motivo')} }) }}`,
        options: { responseCode: 400 },
      },
      id: 'responder-error-03', name: 'Responder a la web: rechazado',
      type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.5, position: [912, 0],
    },
  ],
  connections: {
    'Formulario de la web': { main: [[{ node: 'Validar envío', type: 'main', index: 0 }]] },
    'Validar envío': { main: [[{ node: '¿Envío válido?', type: 'main', index: 0 }]] },
    '¿Envío válido?': { main: [
      [{ node: 'Guardar envío', type: 'main', index: 0 }],
      [{ node: 'Responder a la web: rechazado', type: 'main', index: 0 }],
    ] },
    'Guardar envío': { main: [[{ node: 'Crear o actualizar contacto en HubSpot', type: 'main', index: 0 }]] },
    'Crear o actualizar contacto en HubSpot': { main: [[{ node: 'Responder a la web: recibido', type: 'main', index: 0 }]] },
    'Responder a la web: recibido': { main: [[{ node: 'Avisar por correo', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
});
