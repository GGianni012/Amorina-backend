# Cómo programar los tags NFC 213 para Aquilea 57

## Requisitos

- Tags NFC 213 (NTAG213) — capacidad: 144 bytes, suficiente para URLs
- App **NFC Tools** (Android) — gratuita en Play Store
- Celular Android con NFC habilitado

## Formato del tag

Cada tag graba **una sola URL** que identifica al tag:

```
https://amorina-modules.vercel.app/nfc-pos/?tag=AQ-00001
```

### Convención de IDs

| Rango         | Cantidad | Uso                    |
|---------------|----------|------------------------|
| AQ-00001 a AQ-00100 | 100 | Lote actual           |
| AQ-00101 a AQ-10000 | 9900 | Lotes futuros       |

## Paso a paso: programar un tag con NFC Tools

1. **Abrir NFC Tools** en tu Android
2. Ir a la pestaña **"Write"** (Escribir)
3. Tocar **"Add a record"** → seleccionar **"URL / URI"**
4. En el campo URL, pegar:
   ```
   https://amorina-modules.vercel.app/nfc-pos/?tag=AQ-00001
   ```
   (cambiar `00001` por el número que corresponda)
5. Tocar **"Write"** y acercar el tag NFC al teléfono
6. Esperar confirmación ✅
7. **Verificar**: acercar el tag al celular → debe abrir la URL automáticamente

## Tips

- **Numerá los tags físicamente** (ej: sticker con el número) para no confundirlos
- **Escribí uno y verificá** antes de hacer los 100
- Los NFC 213 se pueden reescribir, pero podés **bloquearlos** en NFC Tools si querés que nadie los sobreescriba
- La URL tiene ~60 caracteres, bien dentro del límite de 144 bytes del NFC 213

## Vincular tag a un socio

Una vez programado el tag, hay dos formas de vincularlo:

### Desde la app NFC POS
1. Acercar el tag al celular del staff
2. Se abre la app y muestra "Tag no vinculado"
3. Ingresar el email del socio
4. Tocar "Vincular tag"

### Desde el endpoint API (programático)
```bash
curl -X POST https://amorina-modules.vercel.app/api/smaq/nfc-link \
  -H "Content-Type: application/json" \
  -d '{"tagId": "AQ-00001", "email": "socio@email.com"}'
```

## Flujo de cobro

1. El socio presenta su tag NFC
2. El staff acerca su celular Android al tag
3. Se abre automáticamente la app NFC POS
4. Muestra nombre, email y balance del socio
5. El staff ingresa el monto a cobrar
6. Toca "Cobrar" → se descuenta del saldo ABA
7. Confirmación en pantalla con nuevo saldo
