# Staff App V2 Blueprint

## Objetivo

Unificar en un solo sistema operativo de sala:

- la app de mozos
- el cobro con ABA por NFC o wallet
- el cobro por transferencia
- la app del cliente en mesa

La home deja de ser "funciones" y pasa a ser "pisos y mesas".

## Principios

- `Supabase` es la fuente unica de verdad operativa.
- `Google Sheets` queda para auditoria, export o backoffice, no para la logica central.
- Los cobros sensibles no se resuelven en el browser: pasan por endpoints backend.
- La UI muestra `ABA`, aunque la base legacy siga usando `citizens.dracma_balance` y `dracma_transactions`.
- El sistema trabaja sobre `sesiones de mesa`: una mesa puede abrir, cerrar y reabrir sesiones a lo largo del dia.

## Apps y roles

### 1. Staff App

Uso:

- abrir mesa
- cargar consumo
- ver cuenta
- cobrar
- cerrar mesa

Roles:

- `waiter`
- `cashier`
- `manager`

### 2. Aquilea App

Uso:

- iniciar sesion
- ver saldo ABA
- escanear QR/NFC de mesa
- pedir desde la mesa
- ver cuenta en vivo
- pagar desde la app

### 3. Admin / Backoffice

Uso:

- auditar movimientos
- corregir pagos
- ver transferencias pendientes
- desactivar mesas
- administrar aliases y menu

## Pantallas exactas

### Staff App

#### A. Login

- ingreso con Google/Supabase Auth
- rol visible
- nombre del turno o sesion de caja

#### B. Pisos y Mesas

Header:

- toggle fijo `PB | Piso 1 | Piso 2`
- buscador por mesa
- filtro `todas | abiertas | cuenta pedida | transferencia pendiente`

Cada card de mesa muestra:

- nombre visible: `Mesa 12`
- color de estado
- total actual
- cantidad de items
- mozo asignado
- si hay cliente vinculado desde la app

Estados de mesa:

- `libre`
- `abierta`
- `pidiendo_cuenta`
- `transferencia_pendiente`
- `pagada`
- `cerrada`

#### C. Cuenta de Mesa

Bloques:

- resumen de mesa
- items activos
- notas
- boton `agregar items`
- boton `pedir cuenta`
- boton `cobrar`

Acciones:

- sumar/quitar items
- anular linea
- mover mesa
- fusionar cuenta

#### D. Cargar Items

Origenes:

- carga manual del mozo
- items pedidos por cliente desde la app

Vista:

- categorias
- productos
- precio
- cantidad
- nota

#### E. Cobrar

Metodos visibles:

- `Carnet NFC ABA`
- `Wallet ABA`
- `Transferencia`
- `Pago desde la app`

##### Carnet NFC ABA

- mozo toca el carnet del cliente
- se identifica al ciudadano por `nfc_tag_id`
- se muestra nombre y saldo
- se confirma cobro
- backend descuenta ABA y cierra/actualiza la cuenta

##### Wallet ABA

- escaneo QR del Google Wallet pass
- se resuelve `walletObjectId`
- se debita ABA por backend

##### Transferencia

- se genera un alias disponible para esa cuenta
- se crea un monto unico o referencia unica
- estado `pendiente`
- cuando se verifica el comprobante o se confirma manualmente, la cuenta pasa a `pagada`

##### Pago desde la app

- si el cliente ya esta vinculado a la mesa:
  - puede pagar total o parcial desde su telefono
  - el staff ve el estado en tiempo real

#### F. Historial / Auditoria

- pagos de la mesa
- eventos
- reversiones
- quien cobro
- por que medio

### Aquilea App

#### A. Estado de ciudadano

- avatar
- tipo de ciudadania
- saldo ABA
- movimientos

#### B. Unirme a una mesa

Formas:

- escanear QR de mesa
- tocar NFC de mesa
- ingresar codigo corto

Resultado:

- el usuario queda vinculado a la `session` activa de la mesa

#### C. Menu en mesa

- categorias
- productos
- carrito
- envio a mesa

#### D. Mi mesa

- items propios
- items totales de la mesa
- saldo pendiente
- estado del pedido
- boton `pedir cuenta`

#### E. Pagar

Metodos:

- `Pagar con ABA`
- `Pagar por transferencia`

Fase 1:

- un solo pagador por mesa

Fase 2:

- division por invitados o por items

## Flujos operativos

### 1. Abrir mesa

1. El mozo entra a `Pisos y Mesas`.
2. Toca `Mesa 12`.
3. Si no hay sesion activa, se crea `pos_table_sessions`.
4. La mesa pasa a estado `abierta`.

### 2. Cargar comanda desde staff

1. El mozo agrega items.
2. Se crea un `pos_order` con `source = staff`.
3. Se agregan `pos_order_items`.
4. La cuenta se recalcula en vivo.

### 3. Cliente se vincula a mesa

1. El cliente escanea un QR/NFC con `claim_token`.
2. El backend resuelve la mesa.
3. Si la mesa no tiene sesion activa:
   - se puede bloquear
   - o crear sesion automatica segun politica
4. Se crea `pos_session_guests`.
5. Staff y cliente ven la misma sesion.

### 4. Cliente pide desde la app

1. El cliente agrega items.
2. Se crea un `pos_order` con `source = client`.
3. El mozo ve el pedido entrar en la mesa activa.

### 5. Cobro por carnet NFC

1. En checkout el mozo elige `Carnet NFC ABA`.
2. El frontend lee/recibe el tag o abre la URL del tag.
3. Se busca el ciudadano.
4. Backend valida saldo.
5. Backend:
   - crea `pos_payment_intents`
   - ejecuta `record_dracma_transaction`
   - registra `pos_payment_events`
6. Si el pago cubre todo, la sesion queda `paid` y luego `closed`.

### 6. Cobro por transferencia

1. El mozo elige `Transferencia`.
2. Se reserva un alias activo del pool.
3. Se crea `pos_payment_intents` con estado `pending`.
4. La mesa pasa a `transferencia_pendiente`.
5. Verificacion:
   - manual
   - o automatica con OCR/vision sobre comprobante
6. Si confirma:
   - `pos_payment_intents.status = confirmed`
   - se registra evento
   - se libera el alias

### 7. Pago desde Aquilea App

1. Cliente vinculado elige `Pagar con ABA`.
2. Backend valida identidad y saldo.
3. Se ejecuta el descuento.
4. Staff ve el pago reflejado en tiempo real.

## Modelo de datos

### Reutilizado

- `public.citizens`
- `public.dracma_transactions`

### Nuevo

- `public.pos_floors`
- `public.pos_tables`
- `public.pos_menu_categories`
- `public.pos_menu_items`
- `public.pos_table_sessions`
- `public.pos_session_guests`
- `public.pos_orders`
- `public.pos_order_items`
- `public.pos_transfer_accounts`
- `public.pos_payment_intents`
- `public.pos_payment_events`

## Contrato de API

### Bootstrap y salon

#### `GET /api/pos/bootstrap`

Devuelve:

- usuario actual
- rol
- pisos
- resumen de mesas
- menu visible

#### `GET /api/pos/floors`

Devuelve pisos ordenados.

#### `GET /api/pos/tables?floor_code=pb`

Devuelve mesas de ese piso con:

- estado
- total
- deuda
- cantidad de items
- mozo
- sesion activa

Idealmente alimentado por una vista tipo `pos_table_live_status`.

#### `POST /api/pos/tables/:tableId/open-session`

Body:

```json
{
  "guestCount": 2,
  "note": "Cumpleanos"
}
```

#### `POST /api/pos/tables/claim`

Para QR/NFC de mesa.

Body:

```json
{
  "claimToken": "AQ-PB-12"
}
```

### Menu y pedidos

#### `GET /api/pos/menu`

Devuelve categorias e items activos.

#### `POST /api/pos/sessions/:sessionId/orders`

Body:

```json
{
  "source": "staff",
  "note": "Sin hielo"
}
```

#### `POST /api/pos/orders/:orderId/items`

Body:

```json
{
  "itemId": "uuid-opcional",
  "itemCode": "vesper",
  "itemName": "Vesper Martini",
  "categoryCode": "cocktails",
  "quantity": 2,
  "unitPriceArs": 12000,
  "note": "Uno sin aceituna"
}
```

#### `PATCH /api/pos/order-items/:itemId`

Permite cambiar cantidad, nota o anular.

### Checkout y pagos

#### `POST /api/pos/sessions/:sessionId/request-check`

Marca la sesion como `pidiendo_cuenta`.

#### `POST /api/pos/payments/aba-nfc`

Body:

```json
{
  "sessionId": "uuid",
  "amountArs": 24000,
  "amountAba": 24,
  "tagId": "AQ-00001"
}
```

#### `POST /api/pos/payments/aba-wallet`

Body:

```json
{
  "sessionId": "uuid",
  "amountArs": 24000,
  "amountAba": 24,
  "walletObjectId": "issuer.object"
}
```

#### `POST /api/pos/payments/transfer`

Body:

```json
{
  "sessionId": "uuid",
  "amountArs": 24000
}
```

Respuesta:

```json
{
  "paymentIntentId": "uuid",
  "alias": "AQUILEA.57.12",
  "ownerName": "Aquilea 57 SRL",
  "bankName": "Uala",
  "reference": "PB12-20260316-1",
  "expiresAt": "2026-03-16T23:59:00.000Z"
}
```

#### `POST /api/pos/payments/:paymentIntentId/confirm-transfer`

Uso:

- confirmacion manual
- confirmacion automatica por OCR/vision

#### `POST /api/pos/payments/app-aba`

Pago disparado desde Aquilea App.

#### `POST /api/pos/sessions/:sessionId/close`

Cierra la sesion si no queda deuda.

## Realtime

Canales recomendados:

- cambios en `pos_table_sessions`
- cambios en `pos_orders`
- cambios en `pos_order_items`
- cambios en `pos_payment_intents`

Efecto esperado:

- un mozo cobra y todos los demas ven la mesa actualizada
- el cliente pide desde la app y la comanda aparece sin refresh
- una transferencia se confirma y la mesa se cierra sola

## Fases de implementacion

### Fase 1. Fundacion operativa

- migracion SQL de `pisos`, `mesas`, `sesiones`, `pedidos`, `pagos`
- staff app nueva con home en mesas
- reemplazo de `localStorage` por Supabase

### Fase 2. Checkout real

- integrar `ABA NFC`
- integrar `ABA Wallet`
- integrar `Transferencia` con pool de aliases

### Fase 3. Cliente en mesa

- Aquilea App puede vincularse a mesa
- ver cuenta
- pedir items
- pagar desde el telefono

### Fase 4. Split y sofisticacion

- pago parcial
- division por persona
- division por items
- propina
- reversiones controladas

## Decisiones tecnicas recomendadas

- Mantener `citizens` y `dracma_transactions` como base del wallet.
- No renombrar todavia `dracma_*` a `aba_*` en base de datos: primero unificar producto y endpoints.
- Reutilizar la logica NFC ya existente y absorberla dentro de `/api/pos/payments/aba-nfc`.
- Reutilizar el demo de transferencias como motor de asignacion/verificacion, pero escribir resultados en `pos_payment_intents`.
- Hacer que la Aquilea App lea y escriba por endpoints POS, no directo a tablas sensibles.

## Asunciones

- El local tiene 3 pisos y aproximadamente 30 mesas por piso.
- El primer release necesita un solo pagador final por mesa.
- La lectura NFC en web movil puede seguir apoyandose en tags que abren URL.
- El precio de menu se administrara desde base de datos, no hardcodeado en HTML.

## Riesgos

- Si el menu sigue hardcodeado en frontends distintos, staff y cliente se van a desalinear.
- Si las transferencias siguen fuera del modelo de pagos, la mesa nunca va a reflejar bien el estado real.
- Si el cliente sigue escribiendo directo a Supabase sin reglas claras, aparece deuda o doble cobro.

## Siguiente paso de implementacion

Implementar primero:

1. `pisos + mesas + sesiones`
2. `pedidos y cuenta viva`
3. `checkout por ABA NFC`
4. `checkout por transferencia`

Recien despues sumar pedido desde Aquilea App.
