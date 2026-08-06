# Fase 3 — Moderación + Buscador (respuesta guardada a petición del usuario, 6 ago 2026)
El usuario pidió guardar esto para retomarlo AL INICIAR FASE 3. Preguntará por ello entonces.

## Moderación (4 problemas distintos)
| Amenaza | Dificultad | Solución |
|---|---|---|
| Insultos/odio/toxicidad | Baja-media | Clasificador IA ya hecho (RESUELTO) |
| Spam/publicidad/enlaces | Media | Reglas + IA + rate-limit |
| Publicidad engañosa | Media-alta | IA + revisión humana |
| Manipulación de mercado (pump-and-dump / tirar acción) | ALTA (la más difícil) | Señales de comportamiento + IA + humano; NO hay producto que lo haga solo |

### Embudo de 3 capas (comprar = reutilizar pieza hecha, muchas veces gratis)
- **Capa 1 — Filtro automático al publicar:** insultos/toxicidad vía **Emergent LLM Key** (prompt de clasificación JSON) — recomendado para empezar, cero servicios nuevos. Alternativas dedicadas: OpenAI Moderation (gratis), Google Perspective (gratis), Hive/Sightengine (pago, también imágenes). Spam = reglas nuestras (rate-limit, lista negra de dominios, no enlaces hasta N msgs/antigüedad). Insulto claro → se BLOQUEA al publicar; dudoso → Capa 2.
- **Capa 2 — Cola de revisión humana** en el panel Admin (reutiliza el actual): marcar/aprobar/borrar/avisar.
- **Capa 3 — Reportes de la comunidad:** botón "reportar" en cada post → misma cola.

### Anti-manipulación de mercado (el caso difícil)
Ningún producto lo detecta (no es lenguaje ofensivo, es comportamiento coordinado). Enfoque:
- Señales de comportamiento: muchas cuentas nuevas empujando el mismo ticker poco líquido a la vez; picos de menciones anómalos.
- IA de intención: "promesa de rentabilidad garantizada", "presión para comprar/vender ya", "objetivo de precio sin fundamento".
- **MOAT único:** contrastar el claim contra los datos propios (POC/POV/Ratio/TAM). Si alguien grita "x10" y tu valoración dice lo contrario → marcar como sospechoso. Discord/Discourse NO pueden.
- Defensas estructurales: disclaimer (ya existe), penny-stocks en modo restringido, antigüedad mínima para postear ideas, palabra final humana.
- Realidad: se reduce y detecta, NO se elimina 100% automático.

## Buscador (por qué no es un simple LIKE)
- LIKE '%x%' no perdona erratas, no hace stemming español (inversión/invertir/inversores), no ignora acentos, no ordena por relevancia, y NO usa índice → escaneo completo lento a escala.
- Opciones: **Mongo text index** = GRATIS, ya lo tenemos → MVP (stemming ES + acentos + ranking básico, suficiente hasta miles de hilos). **Meilisearch/Typesense** = open-source GRATIS auto-alojado (erratas, instant-search, resaltado) cuando crezca. **Algolia/Elastic Cloud** = de pago, solo si escalas muchísimo.
- CORRECCIÓN al plan: el buscador NO hay que pagarlo. Empezar gratis con Mongo text index.

## Recomendación Fase 3 (coste externo ~0€, solo tokens IA ya en uso)
1. Moderación = filtro IA (Emergent LLM Key) + reglas nuestras + cola humana en Admin + botón reportar.
2. Anti-manipulación = señales de comportamiento + IA contrastando claims vs. ratios propios + humano (semiautomático).
3. Buscador = Mongo text index (MVP); Meilisearch/Typesense si el volumen lo exige.
Lo caro es el DISEÑO del flujo, no las herramientas.

## PENDIENTE decidir al iniciar Fase 1 (el usuario dejó abierto)
El agente ofreció enganchar desde el DÍA 1 el filtro básico de insultos/spam con IA en cada mensaje del canal general (para que nazca moderado), dejando anti-manipulación + buscador avanzado para Fase 3. El usuario NO respondió a esto explícitamente → RE-PREGUNTAR al arrancar Fase 1.
