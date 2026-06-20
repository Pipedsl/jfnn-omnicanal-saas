# Plan de Simplificación de Respuestas y Optimización de Costos de IA (Versión Flujo Dual)

Este plan tiene como objetivo reducir el consumo de tokens y acotar al mínimo la intervención del bot de IA (Gemini), asegurando que actúe únicamente como un recolector rápido de datos del vehículo para derivar el caso inmediatamente al vendedor humano, **preservando al mismo tiempo la lógica compleja anterior de forma completamente intacta** para alternar entre ambas versiones libremente.

---

## 🔒 1. Filosofía de Preservación de Código: Flujo Dual

Para garantizar que ningún desarrollo anterior (métodos de pago, envíos, boletas/facturas, abonos) se pierda:
1.  **Copia de Respaldo del Flujo Completo:** Hemos creado el archivo `backend/services/gemini.service.completo.js` que contiene el prompt y el flujo completo con la lógica de cierre, abonos y guías de compra.
2.  **Modularización del Flujo:** El backend puede decidir cuál archivo cargar según una variable de entorno en tu `.env` (ej: `SIMPLE_FLOW=true`), lo que te permite probar la versión simplificada de la competencia y, con solo cambiar una línea, regresar a la versión compleja completa.

---

## 🎯 2. Estrategia de Simplificación: "Filtro Inicial y Derivación"

La estrategia consiste en reducir el alcance del Bot simplificado a **dos roles únicos** y transferir el resto del flujo al vendedor en el sistema.

### A. Alcance Exclusivo del Bot Simplificado
1.  **Recibir el saludo y los repuestos solicitados.**
2.  **Solicitar datos del auto de forma unificada:** `Patente, año o VIN`.
3.  **Confirmar y derivar:** Mostrar el resumen estructurado que ahora incluye la Patente y establecer el estado de la sesión en `ESPERANDO_VENDEDOR` de inmediato.

### B. Funcionalidades Desactivadas en la Versión Simplificada
*   ❌ **Guía de Despacho/Pagos:** El bot ya no pregunta por método de pago ni solicita direcciones de despacho.
*   ❌ **Lógica de Abonos de Encargo:** Toda la lógica compleja de abonos del 50% o montos fijos para repuestos `POR_ENCARGO` queda desactivada en esta versión (el vendedor humano la maneja en el panel).
*   ❌ **Soporte de Garantías:** El bot deriva directo ante reclamos o garantías.

---

## 🛠️ 3. Implementación Arquitectónica de Conmutación (Switch)

Para no alterar destructivamente tu base de código, podemos ajustar la importación de `gemini.service` en el controlador usando una variable en el `.env`:

```javascript
// En backend/controllers/whatsapp.controller.js (ejemplo teórico):
const useSimpleFlow = process.env.SIMPLE_FLOW === 'true';
const geminiService = useSimpleFlow 
    ? require('../services/gemini.service') // Versión simplificada
    : require('../services/gemini.service.completo'); // Versión completa anterior
```

Esto te da la flexibilidad de probar y comparar el comportamiento real de tus clientes con ambos enfoques.

---

## 📈 4. Beneficios Esperados
1.  **Ahorro de Costos de IA (hasta un 65%):** Al reducir la longitud del prompt del sistema a la mitad en el modo simplificado, cada llamada a la API consumirá menos de un tercio de los tokens de entrada habituales.
2.  **Handover Veloz:** Menos de 2 turnos de chat para que el bot pase la conversación marcada como `ESPERANDO_VENDEDOR` con el auto identificado (con Patente/VIN) y los repuestos listos en el panel del vendedor.
3.  **Flexibilidad de Rollback Instantáneo:** Si en algún momento decides volver al bot conversacional completo, solo configuras `SIMPLE_FLOW=false` en el `.env` y el sistema cargará de nuevo el servicio de flujo completo sin tocar código.
