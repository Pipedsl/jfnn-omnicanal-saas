# Plan de Pruebas Manual — JFNN Omnicanal

**Documento para pruebas manuales completas de todos los flujos del asistente WhatsApp.**

**Fecha:** 2026-03-30
**Versión:** 1.0

---

## 📋 Índice

1. [PRUEBA-01: Un vehículo — Online + Retiro local](#prueba-01)
2. [PRUEBA-02: Un vehículo — Online + Domicilio + Factura](#prueba-02)
3. [PRUEBA-03: Un vehículo — Pago Presencial](#prueba-03)
4. [PRUEBA-04: Multi-vehículo directo](#prueba-04)
5. [PRUEBA-05: Multi-vehículo indirecto](#prueba-05)
6. [PRUEBA-06: Cliente indeciso / Abandono](#prueba-06)
7. [PRUEBA-07: Flujo Encargo + Abono](#prueba-07)
8. [PRUEBA-08: Admin rechaza comprobante](#prueba-08)
9. [PRUEBA-09: Múltiples opciones — SELECCION_OPCION](#prueba-09)
10. [PRUEBA-10: Cliente elimina repuesto — REMOVER_REPUESTO](#prueba-10)
11. [PRUEBA-11: Modo Pausa del agente](#prueba-11)
12. [PRUEBA-12: Re-engage — Cliente recurrente](#prueba-12)

---

<a name="prueba-01"></a>
## PRUEBA-01: Un vehículo — Pago Online + Retiro en Local

### Objetivo
Flujo completo desde perfilado hasta entrega en modo retiro en local con pago online.

### Actores
- 📱 Cliente: +56974792500
- 🏪 Vendedor: Dashboard
- 👤 Admin: /verificacion

### Estado Inicial
Base de datos limpia. Cliente sin sesión previa.

### Flujo

#### PASO 1: Cliente inicia (PERFILANDO)
```
📱 CLIENTE: Hola, necesito un alternador para mi Ford Fiesta
```

**Resultado esperado:**
- Gemini responde pidiendo datos del vehículo
- Estado: PERFILANDO
- DB: `entidades.repuestos_solicitados` = [{nombre: "alternador", cantidad: 1, precio: null}]

#### PASO 2: Cliente proporciona datos (PERFILANDO)
```
📱 CLIENTE: Es 2015, bencinero, motor 1.6, patente PDDL87
```

**Resultado esperado:**
- Gemini confirma datos
- DB actualiza: `ano: "2015"`, `patente: "PDDL87"`, `motor: "1.6"`, `combustible: "bencina"`
- Estado: PERFILANDO (aún sin VIN/patente completa)

#### PASO 3: Cliente confirma repuestos (ESPERANDO_VENDEDOR)
```
📱 CLIENTE: Dale, es todo
```

**Resultado esperado:**
- Gemini verifica si tiene: año + (patente OR VIN) + repuestos
- Mensaje no termina con "?"
- **Estado → ESPERANDO_VENDEDOR**
- Gemini envía: "Un momento, estoy validando disponibilidad..."

#### PASO 4: Vendedor cotiza en dashboard (CONFIRMANDO_COMPRA)
**Dashboard Actions:**
- Click en tarjeta de cotización 56974792500
- En "ALTERNADOR":
  - Cantidad: 1
  - Código: ALT-FORD-15
  - Precio: 45000
  - Disponibilidad: EN STOCK
- Nota asesor: "Alternador original Ford, 1 año garantía"
- Horario entrega: [no aplicable]
- Click "Enviar cotización"

**Mensaje recibido por cliente:**
```
🚗 Ford Fiesta 2015
✔️ 1x alternador | Cód: ALT-FORD-15 | $45.000 c/u

TOTAL APROXIMADO: $45.000

¿Deseas confirmar la compra o el encargo de los productos disponibles?
```

**Resultado esperado:**
- **Estado → CONFIRMANDO_COMPRA**
- DB: `cantidad_fijada: true`, `precio: 45000`

#### PASO 5: Cliente elige pago online + retiro (ESPERANDO_COMPROBANTE)
```
📱 CLIENTE: Quiero pagar online, retiro en el local mañana por la mañana
```

**Resultado esperado:**
- Gemini extrae: `metodo_pago: "online"`, `metodo_entrega: "retiro"`, `horario_entrega: "mañana"`
- Gemini **envía datos bancarios:**
```
DATOS PARA TRANSFERENCIA:
🏦 Banco: Itaú
💳 Cuenta: 123456789
🆔 RUT: 76.123.456-7
📧 Email: pagos@jfnn.cl
💰 MONTO: $45.000

Por favor, envíe el comprobante de transferencia aquí.
```
- **Estado → ESPERANDO_COMPROBANTE**

#### PASO 6: Cliente envía comprobante (ESPERANDO_APROBACION_ADMIN)
```
📱 CLIENTE: [Envía captura de transferencia realizada el 2026-03-30 a las 14:35]
```

**Resultado esperado:**
- Backend descarga imagen vía Meta API
- Gemini extrae: monto $45.000, banco, RUT emisor, etc.
- Imagen se guarda en `/uploads/` como `voucher_56974792500_TIMESTAMP.jpg`
- **Estado → ESPERANDO_APROBACION_ADMIN**
- Gemini responde: "Comprobante recibido. Un asesor validará en unos minutos."

#### PASO 7: Admin verifica comprobante (PAGO_VERIFICADO)
**Admin Actions:**
- Navega a `/verificacion`
- Busca cliente 56974792500
- Click en tarjeta → Abre modal
- Verifica:
  - Imagen visible del comprobante
  - Monto extraído: $45.000 (correcto)
  - Datos extraídos: RUT, banco, ID transacción
- Click **"PAGO COMPLETO"** → aprueba

**Resultado esperado:**
- **Estado → PAGO_VERIFICADO**
- DB: `entidades.pago_pendiente.monto = 45000`, `estado_pago: "aprobado"`

#### PASO 8: Vendedor confirma logística (ENTREGADO)
**Dashboard Actions:**
- Click en cliente 56974792500 (ahora en estado PAGO_VERIFICADO)
- Click en pestaña "Logística"
- Seleccionar: "Retiro en local"
- Horario: "Mañana 09:00 - 17:00"
- Click "Confirmar despacho"

**Mensaje recibido por cliente:**
```
✅ PAGO VERIFICADO

Su compra ha sido confirmada:
📦 Alternador | 1 unidad | $45.000

📍 Retiro en local
Dirección: Av. Principal 123, Local 1, Santiago
Horario: Mañana 09:00 - 17:00
Número de referencia: JFNN-2026-ABC123

¿Alguna pregunta? Escriba en este chat.

---
¡Muchas gracias por su compra en Repuestos JFNN! Si quedó satisfecho con nuestro servicio, nos ayudaría muchísimo si nos deja una reseña en Google. 👉 [LINK]
```

**Resultado esperado:**
- **Estado → ENTREGADO**
- Cliente recibe mensaje de logística + link de reseña Google

#### PASO 9: Archivo (Opcional)
**Dashboard Actions:**
- Click en cliente (ahora en ENTREGADO)
- Click "Archivar sesión"

**Resultado esperado:**
- **Estado → ARCHIVADO**
- Datos se copian a tabla `pedidos`
- Session se reinicia en tabla `user_sessions`

### Validación en DB

```sql
-- Verificar sesión final
SELECT phone, estado,
       (entidades->'repuestos_solicitados'->0->>'nombre') as repuesto,
       (entidades->'repuestos_solicitados'->0->>'precio')::int as precio,
       (entidades->>'metodo_pago') as pago,
       (entidades->>'metodo_entrega') as entrega,
       (entidades->>'patente') as patente
FROM user_sessions WHERE phone='56974792500';

-- Resultado esperado: estado=ARCHIVADO, patente=PDDL87, precio=45000, pago=online, entrega=retiro

-- Verificar en pedidos (si fue archivado)
SELECT phone, (data->>'estado') as estado FROM pedidos WHERE phone='56974792500';
```

### Estado Final
✅ ARCHIVADO | Pago verificado | Logística confirmada

---

<a name="prueba-02"></a>
## PRUEBA-02: Un vehículo — Online + Domicilio + Factura

### Objetivo
Flujo con envío a domicilio y solicitud de factura (requiere RUT, razón social).

### Actores
- 📱 Cliente: +56974792501
- 🏪 Vendedor
- 👤 Admin

### Flujo Resumido

**PASO 1-3: Idéntico a PRUEBA-01 (Perfilado)**
```
📱 CLIENTE: Hola, necesito pastillas de freno para mi Chevrolet Optra

[Proporciona: 2012, motor 1.8, diésel, patente ZLSV50]

[Confirma repuestos]
```

**PASO 4: Vendedor cotiza**
- Pastillas de freno delanteras: cantidad 1, precio $18.500

**PASO 5: Cliente elige pago + envío + factura (ESPERANDO_COMPROBANTE)**
```
📱 CLIENTE: Pago online, quiero que me envíen a casa en Providencia.
📱 CLIENTE: Necesito factura a nombre de mi empresa "Transportes ABC Ltda", RUT 76.500.000-K
```

**Resultado esperado:**
- Gemini extrae:
  - `metodo_pago: "online"`
  - `metodo_entrega: "domicilio"`
  - `tipo_documento: "factura"`
  - `datos_factura: { rut: "76500000-K", razon_social: "Transportes ABC Ltda", giro: null }`
  - `direccion_envio: "Av. Providencia 2000, depto 405, Providencia, RM"`
- Gemini envía datos bancarios
- **Estado → ESPERANDO_COMPROBANTE**

**PASO 6: Cliente envía comprobante**
```
📱 CLIENTE: [Envía imagen de transferencia]
```

**PASO 7-8: Admin aprueba, Vendedor confirma logística con número de seguimiento**
```
🏪 VENDEDOR: [En modal de despacho selecciona "Envío a domicilio"]
[Ingresa dirección: Av. Providencia 2000, depto 405]
[Número de seguimiento: JFNN-FEDEX-987654]
[Click "Confirmar despacho"]
```

**Mensaje a cliente:**
```
✅ PAGO VERIFICADO

Envío a domicilio:
📍 Av. Providencia 2000, depto 405, Providencia
📦 Número de seguimiento: JFNN-FEDEX-987654
🚚 Entrega estimada: 3-5 días hábiles

Factura:
Razón Social: Transportes ABC Ltda
RUT: 76.500.000-K

[...]
```

### Validación en DB

```sql
SELECT (entidades->>'direccion_envio') as direccion,
       (entidades->>'tipo_documento') as doc_type,
       (entidades->'datos_factura'->>'razon_social') as empresa
FROM user_sessions WHERE phone='56974792501';
```

### Estado Final
✅ ENTREGADO | Factura generada | Número de seguimiento enviado

---

<a name="prueba-03"></a>
## PRUEBA-03: Un vehículo — Pago Presencial (Efectivo en Local)

### Objetivo
Flujo donde el cliente elige pagar en local (efectivo, presencial). No requiere comprobante.

### Actores
- 📱 Cliente: +56974792502
- 🏪 Vendedor
- 👤 Admin (no interviene en este flujo)

### Flujo Resumido

**PASO 1-3: Perfilado**
```
📱 CLIENTE: Necesito aceite para mi Volkswagen Gol 2008, gasolina, motor 1.6
[...]
📱 CLIENTE: Aceite 10W-40, eso es todo
```

**PASO 4: Vendedor cotiza**
- Aceite 10W-40: cantidad 2, precio $8.500 c/u (total $17.000)

**PASO 5: Cliente elige pago presencial (CICLO_COMPLETO)**
```
📱 CLIENTE: Voy a pagar en efectivo en el local.
```

**Resultado esperado:**
- Gemini extrae: `metodo_pago: "local"`
- Si **NO** tiene nombre del cliente, Gemini pregunta: "¿Me podría confirmar su nombre para agilizar su atención?"
- Si **SÍ** tiene nombre (desde perfil anterior o cliente dice "Me llamo Juan"), sigue directo:
```
Perfecto, su compra está lista para retirar en el local:
📍 Dirección: Av. Principal 123, Local 1
💰 Monto: $17.000

Número de cotización: JFNN-2026-XYZ789

Por favor, mencione este número al llegar. ¡Lo esperamos!
```
- **Estado → CICLO_COMPLETO**

**PASO 6: Cliente no envía comprobante (obviamente)**
- Si el cliente escribe algo más, la IA responde con mensaje estático de espera

**PASO 7: Cliente se presenta en local**
```
[Cliente llega al local mencionando "JFNN-2026-XYZ789"]
🏪 VENDEDOR: Verifica en dashboard, ve que está en CICLO_COMPLETO
[Completa la venta en caja, imprime boleta]
```

**PASO 8: Re-engagement (opcional)**
```
📱 CLIENTE: [Escribe nuevamente] Hola, necesito otro repuesto
```

**Resultado esperado:**
- Sistema detecta re-engagement desde CICLO_COMPLETO
- `archiveSession()` se ejecuta → sesión se copia a pedidos, se crea nueva sesión
- **Estado → PERFILANDO** (nueva sesión)

### Validación en DB

```sql
SELECT estado, (entidades->>'metodo_pago') as pago
FROM user_sessions WHERE phone='56974792502';
-- Resultado esperado: estado=CICLO_COMPLETO, pago=local
```

### Estado Final
✅ CICLO_COMPLETO | Sin comprobante requerido | Pago presencial confirmado

---

<a name="prueba-04"></a>
## PRUEBA-04: Multi-vehículo — Mención Directa

### Objetivo
Cliente menciona explícitamente dos vehículos distintos.
Verifica que Gemini usa `vehiculos[]` en lugar de concatenar con "/".

### Actores
- 📱 Cliente: +56974792503
- 🏪 Vendedor
- 👤 Admin

### Flujo Resumido

**PASO 1: Cliente abre (PERFILANDO)**
```
📱 CLIENTE: Hola, tengo dos autos. Necesito amortiguadores para la Hilux 2010 y pastillas de freno para el V16 2001
```

**Resultado esperado:**
- Gemini reconoce **2 vehículos** en el primer mensaje
- Debe usar `vehiculos[]` (array)
- Pide confirmación de detalles para cada uno

#### PASO 2: Cliente proporciona datos Hilux
```
📱 CLIENTE: Hilux es diésel, motor 3.0, patente PDDL87
```

#### PASO 3: Cliente proporciona datos V16
```
📱 CLIENTE: V16 es bencina, motor 1.6, patente ZLSV50
```

**Resultado esperado:**
- DB después de PASO 3:
```
vehiculos: [
  {
    marca_modelo: "Toyota Hilux",
    ano: "2010",
    patente: "PDDL87",
    motor: "3.0",
    combustible: "diesel",
    repuestos_solicitados: [
      { nombre: "amortiguadores", cantidad: 2, precio: null }
    ]
  },
  {
    marca_modelo: "Nissan V16",
    ano: "2001",
    patente: "ZLSV50",
    motor: "1.6",
    combustible: "bencina",
    repuestos_solicitados: [
      { nombre: "pastillas de freno", cantidad: 1, precio: null }
    ]
  }
]
```

#### PASO 4: Confirmación (ESPERANDO_VENDEDOR)
```
📱 CLIENTE: Dale, eso es todo
```

#### PASO 5: Vendedor cotiza ambos vehículos
**Dashboard:**
```
🏪 VENDEDOR:
Vehículo 1 - Toyota Hilux 2010:
  - Amortiguadores (4): $12.000 c/u (Total: $48.000)

Vehículo 2 - Nissan V16 2001:
  - Pastillas de freno: $18.500 c/u

Nota: Amortiguadores originales. Pastillas semi-metalicas.
```

**Mensaje a cliente:**
```
🚗 Toyota Hilux 2010
✔️ 4x amortiguadores | Cód: AMOR-HILUX | $12.000 c/u (Total: $48.000)

🚗 Nissan V16 2001
✔️ 1x pastillas de freno | Cód: PAST-V16 | $18.500 c/u

TOTAL APROXIMADO: $66.500
```

#### PASO 6-8: Pago + Verificación (igual a PRUEBA-01)

### Validación en DB

```sql
SELECT
  (entidades->'vehiculos' @> '[{"marca_modelo":"Toyota Hilux"}]') as tiene_hilux,
  (entidades->'vehiculos' @> '[{"marca_modelo":"Nissan V16"}]') as tiene_v16,
  jsonb_array_length(entidades->'vehiculos') as num_vehiculos
FROM user_sessions WHERE phone='56974792503';

-- Resultado esperado: tiene_hilux=true, tiene_v16=true, num_vehiculos=2
```

### Estado Final
✅ PAGO_VERIFICADO | 2 vehículos cotizados | Sin concatenación "/"

---

<a name="prueba-05"></a>
## PRUEBA-05: Multi-vehículo — Indirecto (No Explícito)

### Objetivo
Cliente **no dice directamente** que tiene dos autos, pero lo implica en mensajes separados.
Gemini debe detectar y separar en `vehiculos[]`.

### Actores
- 📱 Cliente: +56974792504
- 🏪 Vendedor

### Flujo Resumido

**PASO 1: Primer vehículo (implícito)**
```
📱 CLIENTE: Hola, necesito amortiguadores para mi Toyota Corolla
```

**PASO 2: Cliente da datos Corolla**
```
📱 CLIENTE: Es 2015, bencinero, motor 1.6, patente PDDL87
```

**PASO 3: Cliente menciona segundo vehículo INESPERADAMENTE**
```
📱 CLIENTE: Y también necesito termostato para mi Nissan March
```

**Resultado esperado:**
- Gemini reconoce que ahora hay **2 vehículos**
- Pide datos del March
- **Transición a `vehiculos[]` mode**

**PASO 4: Cliente proporciona datos March**
```
📱 CLIENTE: March 2012, bencinero, motor 1.5, patente ZLSV50
```

**PASO 5: Confirmación (ESPERANDO_VENDEDOR)**

**PASO 6-8: Cotización + Pago (igual flujo)**

### Validación en DB

```sql
SELECT jsonb_array_length(entidades->'vehiculos') as num_vehiculos,
       (entidades->'vehiculos'->0->>'marca_modelo') as auto1,
       (entidades->'vehiculos'->1->>'marca_modelo') as auto2
FROM user_sessions WHERE phone='56974792504';
```

### Estado Final
✅ 2 vehículos detectados automáticamente | Sin duplicados en repuestos

---

<a name="prueba-06"></a>
## PRUEBA-06: Cliente Indeciso / Abandono

### Objetivo
Cliente duda, cambia de opinión, o se despide sin comprar.
Sistema detecta `ABANDONAR_COTIZACION` y resetea sesión.

### Actores
- 📱 Cliente: +56974792505

### Flujo

**PASO 1-3: Perfilado normal**
```
📱 CLIENTE: Necesito bujías para mi Suzuki Swift
📱 CLIENTE: Es 2018, 1.2 bencinero, patente PDDL87
📱 CLIENTE: 4 bujías, eso es todo
```

**Estado:** ESPERANDO_VENDEDOR

**PASO 4: Vendedor cotiza**

**PASO 5: Cliente en duda (CONFIRMANDO_COMPRA)**
```
📱 CLIENTE: Mmm, bastante caro. Lo voy a pensar.
```

**Resultado esperado:**
- Gemini detecta "pensar" + contexto de duda
- Retorna `accion: "ABANDONAR_COTIZACION"`
- Backend llama `resetSession(phone)`
- DB se limpia: entidades vuelven a INITIAL_ENTITIES
- **Estado → PERFILANDO** (limpio)

**PASO 6: Cliente escribe de nuevo (Re-engagement)**
```
📱 CLIENTE: Hola, en realidad sí quiero las bujías
```

**Resultado esperado:**
- Agente responde como si fuera primera vez
- Pide datos del vehículo nuevamente (aunque ya los había dado)

### Validación en DB

```sql
-- Después del ABANDONAR_COTIZACION
SELECT
  (entidades->>'repuestos_solicitados') as repuestos,
  estado
FROM user_sessions WHERE phone='56974792505';

-- Resultado esperado: repuestos=[], estado=PERFILANDO
```

### Estado Final
✅ PERFILANDO (limpio) | Sesión reseteada | Re-profiling posible

---

<a name="prueba-07"></a>
## PRUEBA-07: Flujo Encargo + Abono

### Objetivo
Vendedor cotiza con ítems `POR_ENCARGO`.
Cliente paga abono, admin aprueba como abono, vendedor solicita encargo, llega stock, cliente paga saldo.

### Actores
- 📱 Cliente: +56974792506
- 🏪 Vendedor
- 👤 Admin

### Flujo Completo

**PASO 1-4: Perfilado + Cotización**
```
📱 CLIENTE: Necesito motor completo para Volkswagen Jetta
[...]
```

**PASO 4: Vendedor cotiza CON ENCARGO**

Dashboard:
- Motor completo: cantidad 1, precio $180.000
- Disponibilidad: **POR_ENCARGO** (+ Abono previo)

Mensaje a cliente:
```
🚗 Volkswagen Jetta
📦 1x motor completo | Cód: MOT-JETTA | $180.000 c/u (Requiere abono previo)

TOTAL APROXIMADO: $180.000
```

**PASO 5: Cliente elige pagar abono (ESPERANDO_COMPROBANTE)**
```
📱 CLIENTE: Está bien, pago online. ¿Cuánto abono necesitan?
```

**Resultado esperado:**
- Gemini responde con el monto sugerido (ej: "Mínimo 50%: $90.000")
- Cliente transfiere $90.000

**PASO 6: Cliente envía comprobante de abono**
```
📱 CLIENTE: [Envía imagen de transferencia $90.000]
```

**Estado → ESPERANDO_APROBACION_ADMIN**

**PASO 7: Admin verifica COMO ABONO**

Dashboard `/verificacion`:
- Click en cliente
- Verifica: $90.000 de $180.000
- Click **"ES ABONO"** (en lugar de "PAGO COMPLETO")
- Salva como: `estado_pago: "abono"`, `pago_pendiente.monto: 90000`, `pago_pendiente.es_saldo: true`

**Estado → ABONO_VERIFICADO**

Mensaje a cliente:
```
✅ ABONO RECIBIDO

Hemos registrado su abono de $90.000 para:
📦 Motor completo Volkswagen Jetta

Saldo pendiente: $90.000

Cuando el repuesto llegue, le avisaremos para completar el pago.
```

**PASO 8: Vendedor solicita encargo (2-3 días después)**

Dashboard:
- Click en cliente (ABONO_VERIFICADO)
- Click "Solicitar encargo"
- Completa: "ETA: 3 días hábiles"
- Click "Confirmar"

**Estado → ENCARGO_SOLICITADO**

Mensaje a cliente:
```
📦 ENCARGO SOLICITADO

Hemos pedido su motor completo al proveedor.
ETA: 3 días hábiles

Le confirmaremos cuando llegue al local para completar el pago del saldo ($90.000).
```

**PASO 9: Encargo llega (3 días después)**

Dashboard:
- Click en cliente (ENCARGO_SOLICITADO)
- Click "Marcar encargo como recibido"

**Cálculo:** Saldo = $180.000 - $90.000 = $90.000

**Estado → ESPERANDO_SALDO**

Mensaje a cliente:
```
🎉 ENCARGO LLEGÓ

Su motor completo ya está en nuestro local.

Saldo pendiente: $90.000

Por favor, complete el pago para proceder con la entrega.
Datos para transferencia:
[...datos bancarios...]
```

**PASO 10: Cliente envía comprobante de saldo**
```
📱 CLIENTE: [Envía imagen de transferencia $90.000]
```

**Estado → ESPERANDO_APROBACION_ADMIN**

**PASO 11: Admin verifica SALDO**

Dashboard `/verificacion`:
- Click en cliente
- Aparece tipo: "Verificación de Pago de Saldo"
- Muestra: Abono previo $90.000 + Saldo actual $90.000 = Total $180.000
- Click **"PAGO COMPLETO"** (aprueba saldo)

**Estado → PAGO_VERIFICADO**

**PASO 12: Vendedor confirma logística**

Dashboard:
- Click en cliente (PAGO_VERIFICADO)
- Click "Confirmar despacho"

**Estado → ENTREGADO**

### Validación en DB

```sql
-- Después de PASO 7 (abono aprobado)
SELECT
  (entidades->>'estado') as estado,
  (entidades->'pago_pendiente'->>'monto')::int as abono,
  (entidades->>'total_cotizacion')::int as total
FROM user_sessions WHERE phone='56974792506';

-- Después de PASO 11 (saldo verificado)
-- DB debe mostrar estado=PAGO_VERIFICADO, ambos pagos sumados
```

### Estado Final
✅ ENTREGADO | Abono + Saldo pagados | Encargo completado

---

<a name="prueba-08"></a>
## PRUEBA-08: Admin Rechaza Comprobante

### Objetivo
Admin rechaza un comprobante (incorrecto, monto no coincide).
Cliente debe reenviar, flujo regresa a CONFIRMANDO_COMPRA.

### Actores
- 📱 Cliente: +56974792507
- 🏪 Vendedor
- 👤 Admin

### Flujo Resumido

**PASO 1-5: Flujo normal hasta ESPERANDO_APROBACION_ADMIN**
```
📱 CLIENTE: [Envía comprobante incorrecto]
```

**PASO 6: Admin rechaza**

Dashboard `/verificacion`:
- Click en cliente
- Verifica: Monto extraído $45.000 pero total es $50.000 (no coincide)
- Click **"RECHAZAR"**
- Ingresa motivo: "Monto no coincide. Total debe ser $50.000"

**Resultado esperado:**
- **Estado → CONFIRMANDO_COMPRA** (vuelve atrás)
- Cliente recibe mensaje:
```
❌ COMPROBANTE RECHAZADO

Motivo: Monto no coincide. Total debe ser $50.000

Por favor, verifique su comprobante y reenvíelo.
```

**PASO 7: Cliente reenvía comprobante correcto**
```
📱 CLIENTE: [Envía imagen correcta con $50.000]
```

**Estado → ESPERANDO_APROBACION_ADMIN**

**PASO 8: Admin aprueba**

**Estado → PAGO_VERIFICADO**

### Validación en DB

```sql
-- Después del rechazo
SELECT estado FROM user_sessions WHERE phone='56974792507';
-- Resultado: CONFIRMANDO_COMPRA
```

### Estado Final
✅ PAGO_VERIFICADO (tras re-envío correcto) | 1 rechazo manejado

---

<a name="prueba-09"></a>
## PRUEBA-09: Múltiples Opciones — SELECCION_OPCION

### Objetivo
Vendedor cotiza con 2+ opciones del mismo repuesto (marca diferente, precio diferente).
Gemini presenta opciones, cliente elige, sistema elimina opciones descartadas.

### Actores
- 📱 Cliente: +56974792508
- 🏪 Vendedor (carga múltiples opciones en dashboard)

### Flujo

**PASO 1-4: Perfilado + Cotización con opciones**
```
📱 CLIENTE: Necesito pastillas de freno para mi Hyundai i20
[...]
```

**PASO 4: Vendedor cotiza CON MÚLTIPLES OPCIONES**

Dashboard SellerActionForm:
- Repuesto 1: "Pastilla de freno Bosch"
  - Cantidad: 1
  - Precio: $22.990
  - Código: PAST-BOSCH-I20
- [Click "+ Agregar repuesto"]
- Repuesto 2: "Pastilla de freno Economy"
  - Cantidad: 1
  - Precio: $15.490
  - Código: PAST-ECO-I20
- Nota: "Tenemos 2 opciones de pastillas"
- Click "Enviar cotización"

Mensaje a cliente:
```
🚗 Hyundai i20
✔️ 1x pastilla de freno bosch | Cód: PAST-BOSCH-I20 | $22.990 c/u
✔️ 1x pastilla de freno economy | Cód: PAST-ECO-I20 | $15.490 c/u

TOTAL APROXIMADO: $22.990 (si elige Bosch) o $15.490 (si elige Economy)

Tenemos 2 opciones de pastillas. ¿Cuál prefieres?
```

**Estado → CONFIRMANDO_COMPRA**

**PASO 5: Cliente elige opción (SELECCION_OPCION)**
```
📱 CLIENTE: Prefiero la Bosch, la economy me da desconfianza
```

**Resultado esperado:**
- Gemini detecta: cliente elige "Bosch"
- Retorna `accion: "SELECCION_OPCION"`
  - `opcion_elegida: "Pastilla de freno Bosch"`
  - `opciones_descartadas: ["Pastilla de freno Economy"]`
- Backend llama `removeRepuesto()` para "Pastilla de freno Economy"
- Total se recalcula: $22.990
- DB:  solo queda 1 repuesto

Mensaje a cliente:
```
✅ Opción elegida: Pastilla de freno Bosch

TOTAL ACTUALIZADO: $22.990

Total final a pagar: $22.990
[Continuar con pago...]
```

**PASO 6-8: Pago + Verificación (normal)**

### Validación en DB

```sql
-- Después de SELECCION_OPCION
SELECT jsonb_array_length(entidades->'repuestos_solicitados') as num_repuestos,
       (entidades->'repuestos_solicitados'->0->>'nombre') as repuesto,
       (entidades->>'total_cotizacion')::int as total
FROM user_sessions WHERE phone='56974792508';

-- Resultado esperado: num_repuestos=1, repuesto=Pastilla de freno Bosch, total=22990
```

### Estado Final
✅ PAGO_VERIFICADO | Option elegida: Bosch | Economy removida

---

<a name="prueba-10"></a>
## PRUEBA-10: Cliente Elimina Repuesto — REMOVER_REPUESTO

### Objetivo
Cliente en CONFIRMANDO_COMPRA quiere quitar un ítem de la cotización.
Sistema elimina el repuesto y recalcula total.

### Actores
- 📱 Cliente: +56974792509
- 🏪 Vendedor

### Flujo

**PASO 1-4: Perfilado + Cotización múltiples items**
```
📱 CLIENTE: Necesito aceite, filtro de aire y bujías para mi Honda Civic
[...]
```

**PASO 4: Vendedor cotiza 3 items**
- Aceite: $18.500
- Filtro de aire: $12.990
- Bujías (4): $8.500
- **Total: $39.990**

**PASO 5: Cliente quiere remover uno (CONFIRMANDO_COMPRA)**
```
📱 CLIENTE: En realidad, sácame las bujías. Solo necesito aceite y filtro.
```

**Resultado esperado:**
- Gemini detecta: "sácame las bujías"
- Retorna `accion: "REMOVER_REPUESTO"`, `repuesto_a_remover: "bujías"`
- Backend llama `removeRepuesto()` para "bujías"
- Total se recalcula: $18.500 + $12.990 = $31.490

Mensaje a cliente:
```
✅ Bujías removidas de su pedido

NUEVO TOTAL: $31.490

¿Desea proceder con el pago?
```

**PASO 6-8: Pago (normal)**

### Validación en DB

```sql
SELECT jsonb_array_length(entidades->'repuestos_solicitados') as num_items,
       (entidades->>'total_cotizacion')::int as total
FROM user_sessions WHERE phone='56974792509';

-- Resultado esperado: num_items=2, total=31490
```

### Estado Final
✅ PAGO_VERIFICADO | 1 repuesto removido | 2 items finales

---

<a name="prueba-11"></a>
## PRUEBA-11: Modo Pausa del Agente

### Objetivo
Vendedor pausa el agente para tomar control manual de la conversación.
Cliente no recibe respuestas automáticas mientras está pausado.

### Actores
- 📱 Cliente: +56974792510
- 🏪 Vendedor (pausa/reactiva desde dashboard)

### Flujo

**PASO 1-4: Flujo normal, cliente en CONFIRMANDO_COMPRA**

**PASO 5: Vendedor pausa el agente**

Dashboard:
- Click en cliente
- Botón "🔇 Pausa agente" → activa pausa

DB: `entidades.agente_pausado = true`

**PASO 6: Cliente escribe (AGENTE PAUSADO)**
```
📱 CLIENTE: Hola, tengo una duda sobre el producto
📱 CLIENTE: ¿Cuál es la garantía?
📱 CLIENTE: ¿Puedo cambiar de opinión ahora?
```

**Resultado esperado:**
- Backend verifica `agente_pausado == true` antes de llamar a Gemini
- Los mensajes se ignoran (no hay respuesta automática)
- Log: `[Pausa] Agente pausado para 56974792510. Ignorando mensaje.`
- Vendedor **toma el control manual** escribiendo directamente en WhatsApp

**PASO 7: Vendedor responde manualmente**
```
🏪 VENDEDOR: [Escribe en WhatsApp directamente, no vía dashboard]
Hola, la garantía es de 1 año. Sí, puedes cambiar de opinión. ¿Qué necesitas?
```

**PASO 8: Vendedor reactiva agente**

Dashboard:
- Click en cliente
- Botón "🔊 Reactivar agente" → desactiva pausa

DB: `entidades.agente_pausado = false`

**PASO 9: Cliente escribe (AGENTE REACTIVADO)**
```
📱 CLIENTE: Dale, confirmo mi compra entonces
```

**Resultado esperado:**
- Backend verifica `agente_pausado == false`
- Gemini procesa normalmente
- Agente continúa desde estado anterior (CONFIRMANDO_COMPRA)

**PASO 10-12: Pago (normal)**

### Validación en DB

```sql
-- Cuando está pausado
SELECT (entidades->>'agente_pausado') as pausado FROM user_sessions WHERE phone='56974792510';
-- Resultado: pausado=true

-- Después de reactivar
-- Resultado: pausado=false
```

### Estado Final
✅ PAGO_VERIFICADO | Intervención manual ejecutada | Re-engagement automático

---

<a name="prueba-12"></a>
## PRUEBA-12: Re-engagement — Cliente Recurrente

### Objetivo
Cliente que ya completó una compra inicia una nueva cotización.
Sistema archiva venta anterior, crea nueva sesión en PERFILANDO.

### Actores
- 📱 Cliente: +56974792511 (cliente recurrente)
- 🏪 Vendedor
- 👤 Admin

### Flujo

**PASO 1-8: PRIMERA COMPRA (completa)**
```
📱 CLIENTE: [Primera cotización de terminales]
[...]
```

**Estado final: ENTREGADO**

---

**1+ semana después...**

---

**PASO 9: Cliente inicia re-engagement**
```
📱 CLIENTE: Hola, ahora necesito pastillas de freno
```

**Resultado esperado:**
- Sistema detecta que cliente está en ENTREGADO
- `archiveSession()` se ejecuta automáticamente:
  1. Copia datos de sesión actual a tabla `pedidos`
  2. Actualiza perfil en tabla `clientes` con info del cliente (nombre, email, RUT)
  3. Crea nueva sesión en `PERFILANDO` con entidades iniciales
- Agente responde como si fuera primera vez (pide datos del vehículo)

**PASO 10-11: Perfilado nueva cotización**
```
📱 CLIENTE: Toyota Corolla 2015, bencinero, motor 1.6, patente PDDL87
📱 CLIENTE: Necesito pastillas de freno
```

**Resultado esperado:**
- DB crea nueva sesión (o reutiliza la existente si se reinició)
- El cliente puede o **no** ser pre-poblado con datos anteriores (depende de implementación)
- **Estado → ESPERANDO_VENDEDOR** (nueva cotización)

**PASO 12-15: Nueva cotización + Pago (normal)**

### Validación en DB

```sql
-- Verificar que sesión anterior se archivó
SELECT phone FROM pedidos WHERE phone='56974792511' ORDER BY created_at DESC LIMIT 1;

-- Verificar que nueva sesión está en PERFILANDO
SELECT phone, estado FROM user_sessions WHERE phone='56974792511';
-- Resultado: estado=PERFILANDO (o ESPERANDO_VENDEDOR)

-- Verificar perfil del cliente actualizado
SELECT nombre, email FROM clientes WHERE phone='56974792511';
-- Debe contener datos de la compra anterior
```

### Estado Final
✅ Nueva sesión creada | Venta anterior archivada | Cliente reconocido como recurrente

---

## 🎯 Checklist de Validación General

### Para cada prueba, verificar:

- [ ] **Estado de transición correcto** (seleccionar opción correspondiente)
- [ ] **Mensajes WhatsApp enviados/recibidos** (consultar chat)
- [ ] **Dashboard refleja cambios** (actualizar página con F5)
- [ ] **DB actualizada** (ejecutar queries SQL)
- [ ] **Sin errores en logs** (revisar consola del backend)
- [ ] **Imágenes descargadas** (si aplica) → `/uploads/`
- [ ] **Total recalculado** (si hay cambios de repuestos)
- [ ] **Estado final correcto**

### Herramientas necesarias:

1. **Teléfono con WhatsApp** (cliente o simulador)
2. **Browser con dashboard** (`http://localhost:3000`)
3. **Admin panel de verificación** (`http://localhost:3000/verificacion`)
4. **SQL client** (psql, DBeaver, etc.)
5. **Postman o curl** (opcional, para llamadas directas a API)

---

## 📊 Matriz de Flujos

| Prueba | Vehículos | Pago | Logística | Encargo | Admin | Estado Final |
|--------|-----------|------|-----------|---------|-------|-------------|
| 01 | 1 | Online | Retiro | No | ✓ | ENTREGADO |
| 02 | 1 | Online | Domicilio | No | ✓ | ENTREGADO |
| 03 | 1 | Presencial | Retiro | No | ✗ | CICLO_COMPLETO |
| 04 | 2 | Online | Domicilio | No | ✓ | ENTREGADO |
| 05 | 2 (indirecto) | Online | Domicilio | No | ✓ | ENTREGADO |
| 06 | 1 | Abandoned | N/A | No | ✗ | PERFILANDO |
| 07 | 1 | Online (Abono+Saldo) | Domicilio | ✓ | ✓ | ENTREGADO |
| 08 | 1 | Online (Rechazo) | Domicilio | No | ✓ | PAGO_VERIFICADO |
| 09 | 1 | Online | Retiro | No | ✓ | PAGO_VERIFICADO |
| 10 | 1 | Online | Domicilio | No | ✓ | PAGO_VERIFICADO |
| 11 | 1 | Online (Pausa) | Retiro | No | ✓ | PAGO_VERIFICADO |
| 12 | 1 (re-engagement) | Online | Domicilio | No | ✓ | ENTREGADO |

---

**Última actualización:** 2026-03-30
**Versión:** 1.0
**Autor:** Plan de Pruebas JFNN Omnicanal
