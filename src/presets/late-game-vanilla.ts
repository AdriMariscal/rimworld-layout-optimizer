import type { Layout, Room, Link } from "../model/types";
import { addLink, addRoom, createEmptyLayout, fillUnassignedCells } from "../model/layout";

// Preset de base RimWorld late-game VAINILLA (sin DLCs) para 25-30 colonos
// (capacidad ~48 con margen). Grid 9x9 = 81 celdas; ~58 ocupadas y ~23 libres
// para dar holgura al optimizador (pasillos, expansión).
//
// Convenciones:
// - "celda" del planificador = ZONA 19x19 del juego (361 tiles). 1 celda da
//   para una cocina completa, un comedor pequeño o una habitación grande.
//   1 celda de dormitorio contiene 4 habitaciones de 8x8 con cama doble =
//   8 colonos.
// - hard: true → adyacencia obligatoria.
// - weight → importancia relativa entre soft-links; mayor = se respeta antes.
//
// Modelo hub-and-spoke: productores hard-link a sus almacenes específicos,
// y los almacenes específicos soft-link al Almacén General como overflow.

interface RoomSpec {
  name: string;
  size: number;
  color: string;
}

interface LinkSpec {
  a: string;
  b: string;
  weight?: number;
  hard?: boolean;
}

const ROOM_SPECS: RoomSpec[] = [
  { name: "Bloque Dormitorios 1", size: 3, color: "#3b8132" },
  { name: "Bloque Dormitorios 2", size: 4, color: "#4ea342" },
  { name: "Sala Recreativa",      size: 2, color: "#9cd986" },

  { name: "Cultivos 1",           size: 1, color: "#7ed957" },
  { name: "Cultivos 2",           size: 1, color: "#7ed957" },
  { name: "Congelador",           size: 2, color: "#5fa3d8" },
  { name: "Depósito Frigorífico", size: 1, color: "#404060" },
  { name: "Carnicería",           size: 1, color: "#b03030" },
  { name: "Cocina",               size: 1, color: "#ff7373" },
  { name: "Nevera",               size: 1, color: "#a8d6f0" },
  { name: "Comedor",              size: 3, color: "#d96b3d" },

  { name: "Cervecería",           size: 1, color: "#c9a14a" },
  { name: "Almacén Alcohol",      size: 1, color: "#d4b876" },

  { name: "Enfermería",           size: 2, color: "#ffffff" },
  { name: "Quirófano",            size: 1, color: "#e0f0ff" },
  { name: "Farmacia",             size: 1, color: "#d9eaf7" },

  { name: "Prisión",              size: 1, color: "#555555" },

  { name: "Sastrería",            size: 1, color: "#b88dc1" },
  { name: "Ropero",               size: 1, color: "#c9aacf" },
  { name: "Almacén Telas",        size: 1, color: "#dac4dd" },
  { name: "Almacén Armaduras",    size: 1, color: "#8a7090" },

  { name: "Cantería",             size: 1, color: "#8a8478" },
  { name: "Almacén Trozos",       size: 1, color: "#a0998a" },
  { name: "Almacén Piedra Pulida",size: 1, color: "#c0b8a8" },

  { name: "Escultor",             size: 1, color: "#cdb78a" },
  { name: "Almacén Esculturas",   size: 1, color: "#e0cfa8" },

  { name: "Fundición",            size: 1, color: "#a04a2a" },
  { name: "Almacén Metales",      size: 1, color: "#806858" },
  { name: "Mecanología",          size: 1, color: "#7a5040" },

  { name: "Laboratorio Drogas",   size: 1, color: "#6abf69" },
  { name: "Almacén Drogas",       size: 1, color: "#92d391" },

  { name: "Refinería Chemfuel",   size: 1, color: "#f0a050" },
  { name: "Almacén Chemfuel",     size: 1, color: "#d88040" },
  { name: "Crematorio",           size: 1, color: "#2a2a2a" },

  { name: "Almacén General",      size: 4, color: "#a08060" },
  { name: "Almacén Armas",        size: 1, color: "#603020" },
  { name: "Almacén Munición",     size: 1, color: "#503028" },

  { name: "Investigador",         size: 1, color: "#8060a0" },
  { name: "Sala Servidores",      size: 1, color: "#5040a0" },
  { name: "Sala Comms",           size: 1, color: "#4080c0" },

  { name: "Sala Baterías",        size: 1, color: "#ffd700" },
  { name: "Vestíbulo",            size: 1, color: "#909090" },
  { name: "Sala Defensa",         size: 2, color: "#a02020" },

  { name: "Establo",              size: 2, color: "#a07050" },
];

const LINK_SPECS: LinkSpec[] = [
  // Cadena alimentación
  { a: "Cultivos 1",          b: "Congelador",          hard: true },
  { a: "Cultivos 2",          b: "Congelador",          hard: true },
  { a: "Establo",             b: "Depósito Frigorífico",hard: true },
  { a: "Carnicería",          b: "Depósito Frigorífico",hard: true },
  { a: "Carnicería",          b: "Congelador",          hard: true },
  { a: "Cocina",              b: "Congelador",          hard: true },
  { a: "Cocina",              b: "Nevera",              hard: true },
  { a: "Nevera",              b: "Comedor",             hard: true },

  // Social
  { a: "Comedor",             b: "Bloque Dormitorios 1" },
  { a: "Comedor",             b: "Bloque Dormitorios 2" },
  { a: "Sala Recreativa",     b: "Bloque Dormitorios 1" },
  { a: "Sala Recreativa",     b: "Bloque Dormitorios 2" },

  // Cervecería
  { a: "Cervecería",          b: "Almacén Alcohol",     hard: true },
  { a: "Almacén Alcohol",     b: "Comedor" },

  // Médico
  { a: "Enfermería",          b: "Farmacia",            hard: true },
  { a: "Quirófano",           b: "Farmacia",            hard: true },
  { a: "Enfermería",          b: "Bloque Dormitorios 1" },
  { a: "Enfermería",          b: "Bloque Dormitorios 2" },

  // Textiles
  { a: "Sastrería",           b: "Almacén Telas",       hard: true },
  { a: "Sastrería",           b: "Ropero",              hard: true },
  { a: "Sastrería",           b: "Almacén Armaduras",   hard: true },
  { a: "Almacén Telas",       b: "Almacén General" },
  { a: "Ropero",              b: "Almacén General" },
  { a: "Almacén Armaduras",   b: "Almacén General" },

  // Piedra
  { a: "Cantería",            b: "Almacén Trozos",      hard: true },
  { a: "Cantería",            b: "Almacén Piedra Pulida", hard: true },
  { a: "Almacén Trozos",      b: "Almacén General" },
  { a: "Almacén Piedra Pulida", b: "Almacén General" },

  // Escultura
  { a: "Escultor",            b: "Almacén Esculturas",  hard: true },
  { a: "Escultor",            b: "Almacén Piedra Pulida" },

  // Metal
  { a: "Fundición",           b: "Almacén Metales",     hard: true },
  { a: "Mecanología",         b: "Almacén Metales",     hard: true },
  { a: "Mecanología",         b: "Almacén Armas",       hard: true },
  { a: "Mecanología",         b: "Almacén Munición",    hard: true },

  // Drogas
  { a: "Laboratorio Drogas",  b: "Almacén Drogas",      hard: true },
  { a: "Almacén Drogas",      b: "Almacén General" },

  // Chemfuel
  { a: "Refinería Chemfuel",  b: "Almacén Chemfuel",    hard: true },
  { a: "Refinería Chemfuel",  b: "Sala Baterías" },
  { a: "Almacén Chemfuel",    b: "Almacén General" },

  // Investigación
  { a: "Investigador",        b: "Sala Servidores",     hard: true },
  { a: "Investigador",        b: "Sala Comms" },
  { a: "Sala Baterías",       b: "Sala Servidores" },
  { a: "Sala Baterías",       b: "Sala Comms" },

  // Defensa
  { a: "Sala Defensa",        b: "Vestíbulo",           hard: true },
  { a: "Sala Defensa",        b: "Almacén Armas",       hard: true },
  { a: "Sala Defensa",        b: "Almacén Munición",    hard: true },

  // Vestíbulo
  { a: "Vestíbulo",           b: "Comedor",             weight: 0.5 },
  { a: "Vestíbulo",           b: "Establo" },
];

const GRID_SIZE = 9;

let nextId = 0;
const makeId = (name: string) => `${name.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "")}-${nextId++}`;

export function createLateGameVanillaLayout(): Layout {
  nextId = 0;
  const layout = createEmptyLayout(GRID_SIZE);
  const byName: Record<string, string> = {};
  for (const spec of ROOM_SPECS) {
    const room: Room = {
      id: makeId(spec.name),
      name: spec.name,
      size: spec.size,
      color: spec.color,
    };
    byName[spec.name] = room.id;
    addRoom(layout, room);
  }
  for (const spec of LINK_SPECS) {
    if (!byName[spec.a]) throw new Error(`Preset link references unknown room '${spec.a}'`);
    if (!byName[spec.b]) throw new Error(`Preset link references unknown room '${spec.b}'`);
    const link: Link = {
      a: byName[spec.a],
      b: byName[spec.b],
      weight: spec.weight ?? 1,
      hard: spec.hard === true,
    };
    addLink(layout, link);
  }
  fillUnassignedCells(layout);
  return layout;
}
