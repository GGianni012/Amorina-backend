# Amorina Modules - Sistema de Reservas

Sistema modular para gestión de reservas, pagos con MercadoPago, códigos QR y sincronización con Google Sheets.

## 🎬 Módulos

| Módulo | Descripción |
|--------|-------------|
| `core` | Tipos TypeScript compartidos, configuración, utilidades |
| `google-sheets-service` | Cliente Google Sheets API, sync de reservas y suscripciones |
| `mercadopago-service` | Checkout, webhooks, suscripciones recurrentes |
| `reservations-service` | Gestión de reservas con límite de 60 entradas |
| `qr-service` | Generación y validación de códigos QR |
| `auth-service` | Autenticación con Google OAuth |
| `scanner-app` | PWA React para escanear entradas |

## 📦 Instalación

```bash
npm install
```

## 🔧 Configuración

1. Copiar `.env.example` a `.env` y completar las variables
2. Crear un Service Account en Google Cloud Console
3. Compartir el spreadsheet con el email del service account
4. Configurar MercadoPago con el Access Token de producción

## 🚀 Despliegue en Vercel

Este proyecto está listo para desplegarse en Vercel:

```bash
vercel
```

### Variables de entorno en Vercel

Configurar todas las variables del `.env.example` en el panel de Vercel.

## 📱 Scanner PWA

La app de escaneo se encuentra en `/scanner-app`. Para desarrollo:

```bash
cd scanner-app
npm install
npm run dev
```

Para desplegar, puede ser un sitio separado o una ruta del mismo proyecto.

### Variables de entorno del Scanner

```env
VITE_API_URL=https://tu-api.vercel.app
VITE_SCANNER_USERNAME=amorina
VITE_SCANNER_PASSWORD=tu-password
```

## 📄 Estructura de Google Sheets

El sistema usa una hoja de cálculo con las siguientes pestañas:

### Reservas
| ID | Película | Fecha | Hora | Nombre | Email | Estado Pago | ID Pago | Código QR | Estado QR | Precio Pagado | Precio Original | Suscripción | Fecha Reserva | Fecha Uso |

### Suscripciones
| ID | Email | Nombre | Tipo | Estado | Fecha Inicio | Fecha Fin | Auto-Renovar | ID MercadoPago | Fecha Creación |

## 🔗 API Endpoints

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/checkout` | POST | Crear reserva y checkout de MercadoPago |
| `/api/webhook/mercadopago` | POST | Recibir notificaciones de pago |
| `/api/tickets/validate` | POST | Validar un código QR |
| `/api/tickets/use` | POST | Marcar entrada como usada |

## 🎟️ Flujo de Reserva

1. Usuario selecciona función en la cartelera
2. Sistema verifica disponibilidad (máx 60)
3. Sistema obtiene tipo de suscripción del usuario
4. Se crea reserva en Google Sheets con estado PENDING
5. Se genera preferencia de MercadoPago con precio calculado
6. Usuario es redirigido a MercadoPago para pagar
7. Webhook recibe confirmación y actualiza estado a APPROVED
8. Se genera código QR y se envía al usuario
9. En la puerta, se escanea QR con la PWA
10. Sistema marca entrada como USADA

## 💰 Suscripciones

| Tipo | Descuento | Precio Mensual |
|------|-----------|----------------|
| FREE | 0% | $0 |
| SUPPORTER | 20% | $3,000 |
| VIP | 100% (gratis) | $6,000 |

## 📝 Integración con amorina.club

Para integrar con la página existente:

1. Importar los tipos desde `core/types.ts`
2. Usar `CheckoutService` para crear pagos
3. Llamar a `/api/checkout` desde el frontend
4. Configurar el webhook en MercadoPago

### Ejemplo de uso desde React

```typescript
// En el componente de reserva
const handleReserve = async (showtime: Showtime) => {
  const response = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      showtime,
      userEmail: user.email,
      userName: user.name,
    }),
  });

  const data = await response.json();

  if (data.free) {
    // VIP: entrada gratis, mostrar QR
    showTicketQR(data.ticketCode);
  } else {
    // Redirigir a MercadoPago
    window.location.href = data.initPoint;
  }
};
```

## 📞 Soporte

Para problemas o consultas, abrir un issue en el repositorio.
# Trigger redeploy Sat Feb  7 19:41:25 -03 2026
