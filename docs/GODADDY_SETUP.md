# Guía: Configurar Subdominio en GoDaddy para Supabase

## Paso 1: Obtener la URL de Supabase

1. Ir a [supabase.com](https://supabase.com) y crear cuenta (si no tenés)
2. Crear un nuevo proyecto
3. Una vez creado, ir a **Settings > API**
4. Copiar la URL del proyecto (ej: `abcdefgh.supabase.co`)

---

## Paso 2: Entrar a GoDaddy DNS

1. Ir a [godaddy.com](https://godaddy.com) e iniciar sesión
2. Ir a **Mis Productos** o **My Products**
3. Buscar tu dominio `amorina.club`
4. Hacer clic en **DNS** o **Administrar DNS**

---

## Paso 3: Agregar Registro CNAME

En la sección de registros DNS:

1. Hacer clic en **Agregar** o **Add**

2. Completar así:

| Campo | Valor |
|-------|-------|
| **Tipo** | CNAME |
| **Nombre** | `api` |
| **Valor** | `abcdefgh.supabase.co` (tu URL de Supabase) |
| **TTL** | 1 hora (o el mínimo) |

3. Hacer clic en **Guardar**

---

## Paso 4: Verificar

Después de unos minutos (puede tardar hasta 1 hora), verificar que funcione:

```bash
# En terminal
nslookup api.amorina.club
```

Debería mostrar que apunta a Supabase.

---

## Resultado Final

Tus URLs serán:
- `https://api.amorina.club/functions/v1/checkout`
- `https://api.amorina.club/functions/v1/webhook-mercadopago`
- `https://api.amorina.club/functions/v1/tickets-validate`
- `https://api.amorina.club/functions/v1/tickets-use`

> **Nota**: Si GoDaddy no permite CNAME en subdominio, podés usar la URL de Supabase directamente: `https://tu-proyecto.supabase.co/functions/v1/...`
