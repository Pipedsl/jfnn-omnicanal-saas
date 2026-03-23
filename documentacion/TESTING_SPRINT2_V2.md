# Plan de Pruebas - Sprint 2 V2 (Mejoras IA & Local DB)

Este plan de pruebas valida la implementación de las **Mejoras de IA (HU-1 y HU-2)** y asegura que las funcionalidades previas del Sprint 2 sigan operativas en el nuevo entorno **Docker/PostgreSQL**.

---

## 🧪 Caso de Prueba 1: Eliminar Repuesto de Cotización (HU-1)
**Objetivo**: Validar que el agente puede remover ítems de una cotización activa mediante lenguaje natural.

1.  **Preparación**: Inicia una cotización y avanza hasta el estado `CONFIRMANDO_COMPRA` (donde el bot te da el resumen con precios).
2.  **Acción**: Escribe: *"¿Sabes qué? Al final no voy a llevar el [Nombre del Repuesto], sácamelo de la lista por favor"*.
3.  **Verificación**:
    *   **Respuesta del Bot**: Debe confirmar la eliminación del producto específico.
    *   **Cálculo**: El bot debe mostrar el **nuevo total** restando el precio del ítem eliminado.
    *   **Backend**: Verificar en los logs: `[Sessions] 🗑️ Repuesto "[...]" removido... Total nuevo: $[...]`.
    *   **Dashboard**: La `QuoteCard` debe reflejar la lista actualizada sin el repuesto eliminado.

---

## 🧪 Caso de Prueba 2: Clasificación de Intención Semántica (HU-2)
**Objetivo**: Validar que el bot identifica correctamente cuándo un cliente "vuelve a la carga" con una compra mientras está en `ESPERANDO_VENDEDOR`.

1.  **Escenario A (Consulta de Estado - No es Compra)**:
    *   Lleva una sesión al estado `ESPERANDO_VENDEDOR` (cuando el bot dice "Un asesor revisará el stock...").
    *   Escribe: *"¿Cuánto falta?"* o *"¿Me avisarán por aquí?"*.
    *   **Resultado Esperado**: 
        *   El sistema identifica que **no es una intención de compra**.
        *   El bot responde: *"¡Hola! Estamos buscando los precios para ti, en unos minutos te enviamos la cotización completa. 🔍"*.
        *   El estado **NO** cambia (sigue en `ESPERANDO_VENDEDOR`).

2.  **Escenario B (Nueva Intención de Compra)**:
    *   En el mismo estado `ESPERANDO_VENDEDOR`, escribe: *"Se me olvidó, también necesito el filtro de aceite"* o *"Cotízame también para un Suzuki Swift"*.
    *   **Resultado Esperado**:
        *   El sistema reconoce la intención de compra mediante **Gemini Flash**.
        *   El estado cambia automáticamente a `PERFILANDO`.
        *   El bot responde continuando la conversación y pidiendo datos del nuevo repuesto/vehículo.

---

## 🧪 Caso de Prueba 3: Pago Presencial & Validación Manual (HU-4 Fix)
**Objetivo**: Validar que el flujo de pago en local ahora requiere confirmación del vendedor.

1.  **Acción**: Completa el flujo de compra eligiendo **"Pago en Efectivo/Local"**.
2.  **Verificación - Estado**: La sesión debe quedar en **`CICLO_COMPLETO`**.
3.  **Dashboard**:
    *   La `QuoteCard` debe mostrar el badge: **"Pago Presencial Pendiente"** (animación pulsante).
    *   Debe aparecer el botón: **"Confirmar Pago Recibido en Caja"**.
4.  **Acción Manual**: Presiona el botón de confirmación.
5.  **Resultado Esperado**: El estado avanza a `PAGO_VERIFICADO` y permite seguir con la entrega.

---

## 🧪 Caso de Prueba 4: Estabilidad en Local (Docker/PG)
**Objetivo**: Asegurar que la migración no afectó la persistencia.

1.  **Acción**: Reinicia el backend (`npm run dev`).
2.  **Verificación**: Las cotizaciones en curso deben seguir visibles en el Dashboard con todos sus datos y estados intactos.
3.  **Acción**: Reinicia el contenedor de Docker (`docker compose restart db`).
4.  **Verificación**: El backend debe reconectar automáticamente y seguir funcionando.

---

**Instrucción para el Tester**: Registra cualquier inconsistencia o "alucinación" de la IA durante la eliminación de repuestos para ajustar los prompts si es necesario.
