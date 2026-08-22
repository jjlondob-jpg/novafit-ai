# Novafit AI — Probador Virtual (MVP Nivel 1)

Probador virtual de ropa en tiempo real. Pose estimation y segmentación
corren **100% en el navegador** (MediaPipe Tasks Vision, WASM/GPU) — ningún
frame de video sale del dispositivo del usuario.

---

## 0. Novedades Nivel 3 (fotorrealismo con IA generativa, GRATIS por defecto)

Se agregó un **backend real** (`backend/main.py`, FastAPI) que llama al
modelo de difusión **IDM-VTON** para generar una imagen fotorrealista real
(no una aproximación geométrica). Soporta dos proveedores intercambiables
con una sola línea en `backend/.env`:

| | `PROVIDER=huggingface` (por defecto) | `PROVIDER=replicate` |
|---|---|---|
| Costo | **Gratis** | ~$0.024 USD por generación |
| Dónde corre | Space público de Hugging Face (GPU compartida "ZeroGPU") | GPU dedicada en Replicate |
| Disponibilidad | Depende de un tercero: puede haber cola o estar caído | Confiable, sin cola compartida |
| Uso comercial | ❌ No (licencia CC BY-NC-SA 4.0) | Revisa términos, pero apto para producción |

**Léelo con atención, porque cambia las reglas del juego:**

- ⏱️ **No es tiempo real**, en ningún proveedor. ~15-30 segundos por
  generación (más si hay cola en el modo gratuito). Por diseño es un flujo
  de "foto" (capturas, esperas, ves el resultado).
- 🆓 **"Gratis" no significa "tuyo y garantizado".** El modo Hugging Face
  usa un Space público mantenido por la comunidad (`yisol/IDM-VTON`).
  Puede estar lento, en cola, o directamente pausado sin aviso — no
  depende de ti. Si eso pasa, cambia `HF_SPACE_ID` en `.env` por uno de los
  duplicados listados ahí mismo, o pasa a `PROVIDER=replicate`.
- 🚫 **No uses el modo gratuito para nada comercial.** El modelo tiene
  licencia CC BY-NC-SA 4.0. Para un Novafit real vendiendo ropa, el camino
  correcto es `PROVIDER=replicate` (u otro proveedor con licencia comercial
  clara).
- 🌐 **Tu foto sí sale de tu dispositivo en este modo** (a diferencia del
  Nivel 1/2, que es 100% local) — va al Space/API externo para la
  inferencia. En producción esto implica política de privacidad explícita.

### Cómo activarlo (modo gratuito, por defecto)

1. Instala las dependencias del backend:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```
2. Copia `.env.example` a `.env` dentro de `backend/`. El valor por defecto
   `PROVIDER=huggingface` ya funciona sin ninguna cuenta ni token — es
   opcional agregar un `HF_TOKEN` (gratis, cuenta en huggingface.co) para
   reducir la probabilidad de cola.
3. Levanta el backend (en una terminal **aparte** de la del frontend):
   ```bash
   cd backend
   uvicorn main:app --port 8001
   ```
4. Con el frontend corriendo normalmente en `http://localhost:8000` (ver
   sección 4), ahora tienes **dos servidores corriendo a la vez**:
   - `:8000` → sirve los archivos estáticos (HTML/CSS/JS)
   - `:8001` → backend de IA (FastAPI)
5. En la app, con una prenda seleccionada, pulsa el botón con el ícono de
   ✨ (chispas) en la barra de controles. Verás un modal con spinner
   ("Generando con IA...") y, tras 15-40 segundos (variable, según cola),
   el resultado fotorrealista.

### Si el modo gratuito falla o tarda demasiado

- El error que verás en pantalla incluye el motivo probable (Space caído,
  saturado, o cambio de API) y qué hacer.
- Prueba cambiar `HF_SPACE_ID` en `.env` por otro duplicado del modelo
  (varios listados ahí mismo) y reinicia `uvicorn`.
- Si necesitas confiabilidad garantizada (por ejemplo, para una demo en
  vivo importante), cambia `PROVIDER=replicate` y sigue las instrucciones
  de esa sección más abajo.

### Verificar que el backend está bien configurado

Abre `http://localhost:8001/api/health`. Con el modo gratuito deberías ver:
```json
{"ok": true, "provider": "huggingface", "huggingface_space": "yisol/IDM-VTON", "replicate_configured": null}
```

### Activar el proveedor de pago (Replicate) más adelante

1. Cuenta en [replicate.com](https://replicate.com) + token en
   replicate.com/account/api-tokens.
2. En `backend/.env`: `PROVIDER=replicate` y `REPLICATE_API_TOKEN=r8_...`
3. Reinicia `uvicorn`. El resto de la app no cambia — el botón ✨ sigue
   funcionando igual, solo que ahora sin cola y con costo por uso.

## 0.3 Novedades: catálogo multi-categoría (camisas, chaquetas, hoodies, jeans)

El probador ya no solo prueba camisetas. Ahora hay **16 prendas en 5
categorías**, todas seleccionables desde las pestañas del panel lateral:

| Categoría | Prendas | Región del cuerpo usada |
|---|---|---|
| Camisetas | Negra, blanca, azul, roja | Torso (hombros → cadera) |
| Camisas | Blanca, celeste, negra | Torso (hombros → cadera) |
| Chaquetas | Negra, olive, denim | Torso (hombros → cadera) |
| Hoodies | Gris, negro, vinotinto | Torso (hombros → cadera) |
| Jeans | Azul, negro, light wash | **Piernas (cadera → tobillo)** |

**Cambio técnico importante:** `garment-engine.js` ahora es genérico — cada
prenda del catálogo declara una `region` (`upper_body` o `lower_body`) y el
motor usa los landmarks de pose correspondientes (hombros+cadera para torso,
cadera+tobillos para piernas). Esto es lo que permitió agregar jeans sin
reescribir el pipeline de renderizado.

**Honesto:** para que los jeans se vean bien necesitas estar de cuerpo
COMPLETO en cuadro, con los tobillos visibles — es una exigencia de encuadre
más estricta que las prendas de torso. Si el sistema no ve bien tus tobillos,
usa la última posición válida en vez de romper la forma (mismas protecciones
anti-distorsión que ya existían para camisetas).

Las prendas nuevas viven en `garments/{shirts,jackets,hoodies,jeans}/` y el
catálogo se unificó en un solo archivo: `garments/catalog.json` (antes era
`garments/tshirts/catalog.json`, específico de una sola categoría). Si tenías
el proyecto de una versión anterior, asegúrate de que `app.js` apunte al
nuevo path (ya viene actualizado en este ZIP).

Para agregar una prenda nueva a cualquier categoría, el proceso es el mismo
que ya documentaba este README (sección "Cómo agregar una nueva prenda"),
solo que ahora los campos de anchors se llaman `top_left`/`top_right`/
`bottom_left`/`bottom_right` (genéricos) en vez de `shoulder_left`/`hip_left`
(específicos de camiseta), y cada entrada debe incluir `"region"`.

## 0.2 Chatbot del probador (asistente de compra, vía n8n + Gemini)

Widget de chat flotante (`js/chatbot.js`) embebido en el probador — pensado
para cuando vendas Novafit a una tienda: el comprador puede preguntar tallas,
colores, o cómo usar la cámara, sin salir del flujo de compra.

**Arquitectura:** el widget en el navegador manda cada mensaje por `fetch` a
un **Webhook de n8n**. Ese flujo de n8n llama a **Gemini** (gratis, ver abajo)
y devuelve la respuesta. n8n hace de "backend" — no necesitas escribir
Python/FastAPI para esto.

### Paso 1 — Consigue una API key de Gemini (gratis)

1. Ve a [aistudio.google.com/apikey](https://aistudio.google.com/apikey) e
   inicia sesión con una cuenta de Google.
2. Crea una API key (botón "Create API Key"). Cópiala.
3. Tier gratuito actual (ago. 2026): ~15 solicitudes/minuto y 1,500/día con
   el modelo Flash, sin tarjeta de crédito. De sobra para probar el producto.
   **Aviso de privacidad**: en el tier gratuito, Google puede usar tus
   prompts para entrenar sus modelos. Para producción con datos reales de
   clientes de una tienda, pasa a tier de pago (mismo API, solo activas
   facturación en el proyecto de Google Cloud).

### Paso 2 — Arma el flujo en n8n (n8n.cloud, vía navegador)

Crea un workflow nuevo con estos nodos, en este orden:

1. **Webhook** (nodo trigger)
   - Método: `POST`
   - Path: `novafit-chat` (o el que prefieras)
   - En "Respond": elige **"Using 'Respond to Webhook' node"** (para poder
     armar la respuesta JSON manualmente al final).

2. **AI Agent** (nodo, categoría "AI")
   - En la sección de "Chat Model", conecta un nodo **Google Gemini Chat
     Model** (créalo cuando te lo pida) → pega tu API key de Gemini ahí
     como credencial nueva.
   - En "Source for Prompt": elige "Define below" y en el campo de texto
     pon una expresión que tome el mensaje del webhook:
     `{{ $json.body.message }}`
   - En **System Message** (prompt del sistema), pega algo así (ajústalo a
     tu marca/tono):
     ```
     Eres el asistente de compra de Novafit AI, un probador virtual de
     ropa. Ayudas a los usuarios con preguntas sobre tallas, colores
     disponibles, y cómo usar la cámara del probador. Sé breve, cercano y
     útil. Si te preguntan algo fuera de moda/tallas/uso del probador,
     redirige amablemente la conversación. Responde siempre en español.
     ```
   - Agrega un nodo **Simple Memory** conectado al AI Agent (para que
     recuerde la conversación dentro de la misma sesión) — como "Session
     ID" usa la expresión: `{{ $json.body.sessionId }}`

3. **Respond to Webhook** (nodo final)
   - Respond With: `JSON`
   - Body:
     ```json
     { "reply": "{{ $json.output }}" }
     ```
     (el campo `output` es el texto de salida del AI Agent — si tu versión
     de n8n lo nombra distinto, revisa el panel derecho del nodo AI Agent
     para confirmar el nombre exacto del campo de salida)

4. **Activa el workflow** (interruptor arriba a la derecha del editor).
   n8n te va a mostrar la **Production URL** del webhook (no la de test) —
   algo como `https://tu-instancia.app.n8n.cloud/webhook/novafit-chat`.

### Paso 3 — Conecta el frontend

1. Abre `js/chatbot.js`.
2. Reemplaza la constante `N8N_WEBHOOK_URL` por tu Production URL real.
3. Recarga `localhost:8000` — deberías ver la burbuja de chat flotante
   abajo a la derecha. Pruébala.

### Si el chat no responde

- Abre la consola del navegador (F12) — el widget imprime el error exacto
  ahí (`Chatbot error: ...`).
- La causa más común: el workflow de n8n no está **activado** (el
  interruptor debe estar en verde), o copiaste la URL de test en vez de la
  de producción.
- Puedes probar el webhook directo (sin el frontend) con `curl` para aislar
  si el problema es n8n o el widget:
  ```bash
  curl -X POST https://tu-instancia.app.n8n.cloud/webhook/novafit-chat \
    -H "Content-Type: application/json" \
    -d '{"message":"hola","sessionId":"test123","context":{}}'
  ```

## 0.1 Novedades Nivel 2 (oclusión + warp por malla)

Esta versión ya no usa una sola transformación afín rígida ni una máscara
binaria persona/fondo. Ahora:

- **Human parsing** (`selfie_multiclass_256x256`): en vez de "persona vs.
  fondo", el modelo separa piel del cuerpo, piel del rostro, cabello y ropa.
  Eso permite redibujar tu brazo real POR ENCIMA de la camiseta cuando lo
  cruzas por delante del torso (`renderer.js -> _drawSkinOcclusion`).
- **Mesh warp de 2 triángulos** (`garment-engine.js -> computeMesh`): hombros
  y caderas ahora se posicionan de forma independiente (izquierda/derecha),
  en vez de moverse en bloque como un solo rectángulo. Se nota más al girar
  el torso.
- **Sombreado procedural**: un degradado sutil oscurece el lado del torso
  que está "más rotado" para sugerir volumen. **Esto es un truco visual, no
  una simulación física de tela** — no genera pliegues reales.

**Sigue sin resolver** (eso es Nivel 3): manga larga cruzando manga larga
(tela sobre tela — el modelo no distingue capas ahí), pliegues dinámicos
reales, y cambios de iluminación realistas sobre la tela.

**Si la oclusión de piel no calza bien con tus brazos**: abre
`js/segmentation.js` y revisa la constante `PARSING_CLASSES` — los índices
de categoría están documentados ahí según el model card oficial de
MediaPipe, pero pueden variar ligeramente entre versiones del modelo. Es el
primer lugar a ajustar.

## 1. Qué es esto exactamente (y qué no)

Esto es un **MVP Nivel 1**: overlay de prenda con transformación afín guiada
por pose estimation + recorte por silueta. Es real y funcional, no una
maqueta. Pero es técnicamente honesto reconocer sus límites:

| | Nivel 1 (esto) | Nivel 2 | Nivel 3 | Nivel 4 |
|---|---|---|---|---|
| Técnica | Pose + affine overlay | Cloth warping + human parsing | Modelos de difusión (IDM-VTON/CatVTON) | Todo lo anterior + infraestructura |
| Dónde corre | Navegador (cliente) | Navegador + WebGL shaders | Backend con GPU | Cloud escalable |
| Pliegues de tela | ❌ No | ✅ Aproximado | ✅ Realista | ✅ Realista |
| Oclusión brazo/torso | Aproximada (silueta completa) | ✅ Por parte del cuerpo | ✅ Precisa | ✅ Precisa |
| Texturas/iluminación realista | ❌ No | Parcial | ✅ Sí | ✅ Sí |
| Requiere servidor | No | No (o parcial) | Sí (GPU) | Sí |

Si necesitas ropa que "cae" con pliegues reales, cambia de color en tiempo
real bajo distinta iluminación, o funciona perfecto cuando el brazo cruza el
torso — eso es Nivel 2/3, y requiere las piezas descritas en la sección 8.

## 2. Requisitos

- Navegador moderno: **Chrome o Edge recomendado** (mejor soporte de WebGL/GPU
  delegate). Firefox funciona con degradación a CPU. Safari iOS 16+ funciona
  pero puede ser más lento.
- Cámara web o cámara de dispositivo móvil.
- **Conexión a internet la primera vez** (los modelos de IA de MediaPipe y las
  fuentes se cargan desde CDN; el navegador los cachea después).
- Python 3 (o Node.js) instalado, solo para servir los archivos localmente.

## 3. ⚠️ Por qué necesitas un servidor local (no abrir el archivo directo)

`getUserMedia` (acceso a cámara) **solo funciona en un "contexto seguro"**:
`https://` o `http://localhost`. Abrir `index.html` con doble clic
(`file://...`) hará que el navegador **bloquee la cámara silenciosamente o
con un error de permisos**. Por eso hay que servir la carpeta con un servidor
HTTP local.

## 4. Instalación y ejecución

No hay dependencias de build (es JavaScript vanilla con ES Modules, sin
webpack/vite). Solo necesitas un servidor estático.

**Opción A — Python (ya lo tienes si hiciste esto):**
```bash
cd novafit-ai
python3 -m http.server 8000
```
Abre: **http://localhost:8000**

**Opción B — Node.js:**
```bash
cd novafit-ai
npx serve -l 8000
```
Abre: **http://localhost:8000**

**Opción C — VS Code:** extensión "Live Server" → clic derecho en
`index.html` → "Open with Live Server".

## 5. Probar la cámara paso a paso

1. Abre `http://localhost:8000` — debe verse la pantalla de bienvenida oscura
   con el botón **START VIRTUAL TRY-ON**.
2. Pulsa el botón. El navegador pedirá permiso de cámara → **Permitir**.
3. Deberías ver tu video en vivo y, en unos segundos, el badge **AI Idle**
   cambia a **AI Active** (los modelos de pose/segmentación terminaron de
   cargar — la primera vez tarda más porque se descargan).
4. Colócate a ~2-3 metros, de cuerpo completo. Cuando el sistema te detecte
   bien, el badge pasa a **Body Detected** y el texto de guía dice
   "Perfect position".
5. Elige una camiseta del panel derecho (o inferior en móvil) → debe
   aparecer sobre tu torso y seguir tu movimiento.
6. Prueba **espejo**, **cambiar cámara** (si tienes varias), **pantalla
   completa** y **tomar foto** desde la barra de controles inferior.

**Si no ves nada / pantalla negra:** abre la consola del navegador (F12) —
casi siempre es: (a) permiso denegado, (b) otra app usando la cámara, o
(c) no estás en `localhost`/`https`.

## 6. Cómo agregar una nueva prenda

Las prendas **no están hardcodeadas en JS** — viven en
`garments/tshirts/catalog.json`. Para agregar una nueva:

1. Coloca el PNG (fondo transparente, vista frontal) en `garments/tshirts/`.
2. Añade una entrada al array `items` de `catalog.json`:
   ```json
   {
     "id": "green-tshirt",
     "name": "Forest Green Tee",
     "category": "tshirt",
     "color": "green",
     "colorHex": "#2E8B57",
     "image": "garments/tshirts/green.png",
     "anchors": {
       "shoulder_left":  [172, 118],
       "shoulder_right": [428, 118],
       "hip_left":       [150, 660],
       "hip_right":      [450, 660],
       "chest_center":   [300, 320]
     }
   }
   ```
3. Los `anchors` son las coordenadas **en píxeles de tu imagen PNG** que
   corresponden a hombro izquierdo/derecho y cadera del maniquí/patrón usado
   para diseñar la prenda. Si todas tus prendas comparten el mismo corte
   (igual que las 4 incluidas), reutiliza los mismos anchors.
4. Recarga la página — no hace falta tocar ningún `.js`.

Para conectar esto a un catálogo real de tienda (Shopify/WooCommerce/API
propia), reemplaza el `fetch('garments/tshirts/catalog.json')` en `app.js`
por una llamada a tu API que devuelva el mismo formato.

## 7. Estructura del proyecto

```
novafit-ai/
├── index.html                 UI: bienvenida + pantalla de la app
├── css/styles.css             Sistema de diseño (tokens, layout responsive)
├── js/
│   ├── app.js                 Orquestador: conecta todos los módulos
│   ├── camera.js               getUserMedia, permisos, cambio de dispositivo
│   ├── pose.js                 Pose estimation (MediaPipe PoseLandmarker)
│   ├── segmentation.js         Human parsing (MediaPipe ImageSegmenter multiclase)
│   ├── garment-engine.js       Landmarks -> malla de 2 triángulos (afines)
│   ├── renderer.js             Loop de render: video+prenda+oclusión+sombreado
│   ├── ui.js                   DOM: badges, panel de prendas, controles, modal IA
│   ├── chatbot.js               Widget de chat flotante (habla con n8n)
│   └── utils.js                EventBus, smoothing, álgebra de la afín
├── garments/tshirts/
│   ├── catalog.json             Catálogo estructurado (metadatos + anchors)
│   └── black/white/blue/red.png Prendas base (silueta vectorial)
├── backend/                    NIVEL 3 — servicio aparte, opcional
│   ├── main.py                  FastAPI: llama a IDM-VTON en Replicate
│   ├── requirements.txt
│   └── .env.example
└── README.md
```

## 8. Cómo evolucionar hacia AI Virtual Try-On real (Nivel 2 → 3)

`garment-engine.js` fue diseñado con una interfaz estable
(`computeTransform(landmarks, canvasSize, garment, image) -> matrix`)
justamente para que el resto de la app (renderer, UI, cámara) **no tenga que
cambiar** cuando subas de nivel:

**Nivel 2 — Cloth warping + human parsing (aún en navegador o con backend ligero):**
- Sustituir la transformación de 3 puntos por una malla (grid) con más puntos
  de control (codos, cintura) y aplicar *thin-plate-spline* o deformación por
  malla en **WebGL** (shaders), no Canvas 2D.
- Cambiar `ImageSegmenter` genérico por un modelo de *human parsing*
  (segmentación por partes: torso, brazo-izq, brazo-der, piernas) para
  resolver oclusión real cuando el brazo pasa delante del torso.

**Nivel 3 — Modelos generativos (requiere backend + GPU):**
- Crear un backend **FastAPI** con un endpoint `POST /api/vto` que reciba
  `{ frame: base64, garment_id }` y devuelva la imagen generada por un modelo
  como IDM-VTON o CatVTON corriendo en GPU.
- En el frontend, `garment-engine.js` deja de calcular una matriz local y en
  su lugar llama a ese endpoint; `renderer.js` dibuja la imagen devuelta en
  vez de aplicar `setTransform`. El resto de la UI (cámara, badges, panel de
  prendas) sigue funcionando igual.
- Esto ya no puede ser tiempo real frame-a-frame con latencia cero: se
  necesita throttling (ej. generar cada 500ms-1s) o un modo "foto" en vez de
  "video continuo", porque la inferencia de difusión es costosa incluso en GPU.

**Nivel 4 — Producto comercial:**
- Cola de inferencia (ej. con colas gestionadas + autoscaling de GPU),
  CDN para assets de prendas, integración con catálogo real (Shopify API /
  WooCommerce REST API), analítica de conversión ("probó" → "compró"),
  autenticación, límites de uso, y cumplimiento de privacidad (ya que en
  Nivel 3 el frame SÍ viaja a un servidor, hace falta política de retención
  de datos explícita).

## 9. Rendimiento

- Objetivo: 30 FPS+. El contador de FPS real se muestra en la esquina
  superior derecha del stage de cámara.
- La segmentación (más costosa que la pose) corre cada 2 frames, no cada
  frame, y se reutiliza la última máscara válida — balance entre precisión
  visual y rendimiento.
- Todos los canvas auxiliares (máscara, prenda) se crean **una sola vez** y
  se reutilizan en cada frame para evitar presión sobre el garbage collector.

## 10. Privacidad

El video nunca sale del dispositivo en este MVP: pose estimation y
segmentación corren con WASM/GPU delegate directamente en el navegador. No
hay `fetch`/`XHR` que envíe frames a ningún servidor. Esto deja de ser cierto
en Nivel 3, donde el frame necesariamente viaja al backend con GPU — en ese
punto hace falta una política de privacidad y retención de datos explícita.
