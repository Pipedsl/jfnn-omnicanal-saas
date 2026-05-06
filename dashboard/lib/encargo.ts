export interface RepuestoLike {
  disponibilidad?: 'DISPONIBLE' | 'SIN_STOCK' | 'POR_ENCARGO';
  [key: string]: any;
}

export interface EntidadesLike {
  repuestos_solicitados?: RepuestoLike[] | null;
  vehiculos?: Array<{ repuestos_solicitados?: RepuestoLike[] | null }>;
  [key: string]: any;
}

/**
 * Detecta si una sesión tiene al menos un repuesto marcado como POR_ENCARGO.
 * REQ-06: activa el sub-flujo de abono/encargo.
 */
export function tieneRepuestosPorEncargo(entidades: EntidadesLike | null | undefined): boolean {
  if (!entidades) return false;
  const checkArr = (arr?: RepuestoLike[] | null) =>
    Array.isArray(arr) && arr.some(r => r?.disponibilidad === 'POR_ENCARGO');
  if (checkArr(entidades.repuestos_solicitados)) return true;
  if (Array.isArray(entidades.vehiculos)) {
    return entidades.vehiculos.some(v => checkArr(v?.repuestos_solicitados));
  }
  return false;
}
