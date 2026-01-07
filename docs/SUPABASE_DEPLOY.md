# Guía: Deploy a Supabase

## Requisitos Previos

1. Cuenta en [supabase.com](https://supabase.com)
2. [Supabase CLI](https://supabase.com/docs/guides/cli) instalado
3. Credenciales de MercadoPago y Google Sheets

---

## Paso 1: Instalar Supabase CLI

```bash
# En Mac
brew install supabase/tap/supabase

# O con npm
npm install -g supabase
```

---

## Paso 2: Login y Link

```bash
# Login en Supabase
supabase login

# Ir al directorio del proyecto
cd /Users/SoniaSantoro/.gemini/antigravity/scratch/amorina-modules

# Linkar con tu proyecto
supabase link --project-ref TU_PROJECT_ID
```

El `project_id` lo encontrás en:
Dashboard → Settings → General → Reference ID

---

## Paso 3: Configurar Secrets

```bash
# MercadoPago
supabase secrets set MERCADOPAGO_ACCESS_TOKEN=APP_USR-xxxxx
supabase secrets set MERCADOPAGO_PUBLIC_KEY=APP_USR-xxxxx

# Google Sheets
supabase secrets set GOOGLE_SHEETS_ID=tu-spreadsheet-id
supabase secrets set GOOGLE_SERVICE_ACCOUNT_EMAIL=cuenta@proyecto.iam.gserviceaccount.com
supabase secrets set GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nxxxxx\n-----END PRIVATE KEY-----\n"

# URLs
supabase secrets set BASE_URL=https://amorina.club
supabase secrets set BASE_PRICE=6000

# Scanner
supabase secrets set SCANNER_USERNAME=amorina
supabase secrets set SCANNER_PASSWORD=tu-password
```

---

## Paso 4: Deploy Functions

```bash
# Deploy todas las funciones
supabase functions deploy checkout
supabase functions deploy webhook-mercadopago
supabase functions deploy tickets-validate
supabase functions deploy tickets-use
```

---

## Paso 5: Verificar

Después del deploy, tus endpoints serán:

```
https://TU_PROJECT_ID.supabase.co/functions/v1/checkout
https://TU_PROJECT_ID.supabase.co/functions/v1/webhook-mercadopago
https://TU_PROJECT_ID.supabase.co/functions/v1/tickets-validate
https://TU_PROJECT_ID.supabase.co/functions/v1/tickets-use
```

Probá con curl:

```bash
curl -X POST https://TU_PROJECT_ID.supabase.co/functions/v1/checkout \
  -H "Content-Type: application/json" \
  -d '{"showtime": {"title": "Test", "showtime": "2026-01-10T20:00:00", "price": "6000", "poster": ""}, "userEmail": "test@test.com", "userName": "Test User"}'
```

---

## Paso 6: Configurar Webhook en MercadoPago

1. Ir a [MercadoPago Developers](https://www.mercadopago.com.ar/developers/panel/app)
2. Seleccionar tu aplicación
3. Ir a **Notificaciones > Webhooks**
4. Agregar URL: `https://TU_PROJECT_ID.supabase.co/functions/v1/webhook-mercadopago`
5. Eventos: `payment`

---

## Desarrollo Local

Para probar localmente:

```bash
supabase start
supabase functions serve checkout --env-file .env.local
```
