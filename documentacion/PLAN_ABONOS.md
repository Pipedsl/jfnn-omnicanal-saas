# Especificación Arquitectónica: Flujo de Abonos / Pedidos por Encargo

Este documento describe la arquitectura, estados y flujos funcionales para gestionar repuestos por encargo.
**Rol**: Arquitecto Lead (@arquitecto-lead)

## 📌 Épicas
* **Épica 1**: Gestión de ciclo de vida completo de repuestos por encargo integrando WhatsApp y el Dashboard del Vendedor.

## 🎯 Historias de Usuario (HU)

1. **HU-1: Visibilidad de Encargos Aprobados (Urgencia P0 - Crítico)**
   * *Como* Vendedor, *quiero* ver en el Dashboard las tarjetas de los clientes cuyo abono fue certificado por el Admin, *para* saber a quiénes debo encargar repuestos.
   * *Criterios de Aceptación (DoD)*: El endpoint `getAllPendingSessions` debe incluir tarjetas en estado `ABONO_VERIFICADO`.

2. **HU-2: Notificación de Encargo Solicitado (Urgencia P1 - Importante)**
   * *Como* Vendedor, *quiero* notificar al cliente cuándo llegarán sus repuestos (ETA) al marcar "Encargar a Proveedor", *para* mantener informado al cliente y reducir la fricción post-abono.
   * *Criterios de Aceptación (DoD)*: El Frontend debe mostrar un modal para estimar días de espera y el Backend debe enviar un WhatsApp template avisando de esto, cambiando la cotización al nuevo estado `ENCARGO_SOLICITADO`.

3. **HU-3: Recepción de Repuestos y Cobro de Saldo Restante (Urgencia P1 - Importante)**
   * *Como* Vendedor, *quiero* avisarle al cliente que los repuestos ya están físicamente en el local y (si aplica) pedirle el pago del saldo, *para* poder completar el ciclo de la venta (entregarlo presencial o despacharlo).
   * *Criterios de Aceptación (DoD)*: El Dashboard debe permitir calcular el *Saldo Restante* (Total - Abono Extraído por IA/Admin) y enviar un mensaje de WhatsApp cobrando ese saldo. La cotización pasaría al estado preexistente `CONFIRMANDO_COMPRA` o uno nuevo como `ESPERANDO_SALDO`.

---

## 🛠️ Modificaciones Arquitectónicas Propuestas

### Máquina de Estados (Actualización en `sessions.service.js`)

Se integrarán 2 estados operacionales nuevos en el ciclo de ventas.

*   `ESPERANDO_APROBACION_ADMIN`: El Admin valida el primer voucher.
*   **`ABONO_VERIFICADO`** (Ya creado): Salida exitosa de Verificación si el botón fue "ES ABONO". La card está esperando que el vendedor compre al proveedor.
*   **`ENCARGO_SOLICITADO` (NUEVO)**: El vendedor compró al proveedor y avisó al cliente. La card "espera" en esta columna hasta que el producto llegue al mostrador.
*   **`ENCARGO_RECIBIDO_EN_LOCAL` (NUEVO)**: Los repuestos llegaron físicamente. Si el cliente debe saldo, se envía WhatsApp pidiendo el resto. Si el abono pagó todo (poco probable), se pasa a `ENTREGADO`.

### Flujo Secuencial
1. **Cliente envía Abono** -> *(Bot IA clasifica como Comprobante)*
2. **Dashboard Verificación** -> *Admin aprueba como Abono* -> `ABONO_VERIFICADO`
3. **Dashboard Vendedor** -> *Vendedor da click en "Pedir a Proveedor", mete días ETA* -> Backend envía mensaje al cliente -> `ENCARGO_SOLICITADO` (Card descansa).
4. *(Pasan unos días, repuestos llegan)* -> **Dashboard Vendedor** -> *Da clic en "Llegaron los repuestos, cobrar saldo"* -> Backend calcula el saldo (Monto Total Repuestos - Monto Voucher Pagado). Backend envía WA al cliente con número de cuenta para pagar el resto -> `CONFIRMANDO_COMPRA` (para que el cliente mande otro voucher y la IA lo reciba y lo pase de nuevo a admin).

### Estructura de Datos Base de Datos (`entidades` JSON)
Necesitamos almacenar dentro de memoria (Supabase `entidades`) cuánto se pagó realmente en el abono para calcular correctamente el saldo.
```json
// Agregados a Entidades
"monto_abono_pagado": 45000, 
"saldo_pendiente": 55000
```

---

*Diseñado bajo las directrices del perfil Arquitecto Lead JFNN.*
