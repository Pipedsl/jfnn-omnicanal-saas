CONTEXTO DEL SISTEMA: JFNN AI-Agent & SaaS Core
1. Misión del Proyecto
Construir un Agente de IA Omnicanal nativo para WhatsApp y un Dashboard Propietario para atención al cliente, utilizando una arquitectura SaaS Multi-Tenant (Multi-Inquilino). El cliente inicial es "Repuestos Automotrices JFNN".

2. Stack Tecnológico Obligatorio
Frontend (Dashboard): Next.js, TailwindCSS (Interfaz limpia e intuitiva, 100% No-Code para el usuario final).

Backend & Orquestación: Node.js / Express (para manejar webhooks y lógica de negocio).

Base de Datos: PostgreSQL (preparado para arquitectura Multi-Tenant con separación lógica de esquemas).

IA & Multimodalidad: Familia de modelos Google Gemini (Flash/Pro) a través de API oficial para procesar texto, audio (notas de voz) e imágenes (fotos de repuestos).

Integraciones externas: API de Meta (WhatsApp Cloud API) y llamadas a API REST gubernamentales (Patentes Chile).

3. Reglas de Desarrollo (Directrices para el Agente)
Agent-First: Piensa como un arquitecto. Antes de escribir código, planifica la estructura y genera artefactos de diseño.

Eficiencia: Mantén las dependencias al mínimo. Prioriza el uso de la biblioteca estándar de Node.js donde sea posible.

Modularidad: Utiliza el protocolo MCP (Model Context Protocol) para conectar las bases de datos y la arquitectura de "Agent Skills" para que el bot pueda cambiar de rubro en el futuro.