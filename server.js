import { createServer as createHttpServer } from 'node:http'
import { createServer as createViteServer } from 'vite'

process.loadEnvFile?.()

const port = Number(process.env.PORT || 5173)
const appId = process.env.APPSHEET_APP_ID
const accessKey = process.env.APPSHEET_ACCESS_KEY
const appSheetTables = ['Reservas', 'Sets', 'Usuarios']

const readTable = async (tableName) => {
  if (!appId || !accessKey) throw new Error('Faltan APPSHEET_APP_ID o APPSHEET_ACCESS_KEY en .env')

  const response = await fetch(`https://api.appsheet.com/api/v2/apps/${appId}/tables/${encodeURIComponent(tableName)}/Action`, {
    method: 'POST',
    headers: { ApplicationAccessKey: accessKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Action: 'Find',
      Properties: { Locale: 'es-CO', Timezone: 'America/Bogota' },
      Rows: [],
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`AppSheet rechazó ${tableName} (${response.status}): ${detail.slice(0, 240)}`)
  }

  const payload = await response.json()
  return Array.isArray(payload) ? payload : payload.Rows || payload.rows || []
}

const normalizeKey = (key) => key.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

const getValue = (row, names) => {
  const entries = Object.entries(row || {})
  const wanted = names.map(normalizeKey)
  const match = entries.find(([key]) => wanted.includes(normalizeKey(key)))
  return match?.[1] ?? ''
}

const text = (value) => String(value ?? '').trim()
const idOf = (row, names) => text(getValue(row, names))
const sameId = (left, right) => text(left) !== '' && text(left).toLowerCase() === text(right).toLowerCase()

const todayKey = () => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

const dateKey = (value) => {
  const raw = text(value)
  if (!raw) return ''
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return iso ? `${iso[2]}/${iso[3]}/${iso[1]}` : raw
}

const timeValue = (value) => text(value).slice(0, 5)

const statusOf = (equipment, reservation) => {
  const equipmentStatus = text(getValue(equipment, ['Estado', 'Status', 'Situacion'])).toLowerCase()
  const reservationStatus = text(getValue(reservation, ['Estado', 'Status'])).toLowerCase()
  if (['mantenimiento', 'maintenance', 'reparacion', 'reparación', 'dañado', 'danado'].some((value) => equipmentStatus.includes(value))) return 'maintenance'
  if (reservation && !['cancelada', 'cancelado', 'rechazada', 'rechazado', 'finalizada', 'finalizado', 'devuelta', 'devuelto'].some((value) => reservationStatus.includes(value))) return 'loaned'
  return 'available'
}

const buildBoards = ({ Reservas = [], ReservaEquipos = [], Equipos = [], Sets = [], GrupoSets = [], Salones = [], Usuarios = [] }) => {
  const setById = new Map(Sets.map((row) => [idOf(row, ['SetId', 'Id']), row]))
  const groupById = new Map(GrupoSets.map((row) => [idOf(row, ['GrupoSetId', 'GrupoId', 'Id']), row]))
  const reservationById = new Map(Reservas.map((row) => [idOf(row, ['ReservaId', 'Id']), row]))
  const equipmentById = new Map(Equipos.map((row) => [idOf(row, ['EquipoId', 'Id']), row]))
  const userById = new Map(Usuarios.map((row) => [idOf(row, ['UsuarioId', 'Id']), row]))
  const roomById = new Map(Salones.map((row) => [idOf(row, ['SalonId', 'Id']), row]))
  const reservationsByEquipment = new Map()

  for (const relation of ReservaEquipos) {
    const equipmentId = idOf(relation, ['EquipoId', 'Equipo', 'Codigo'])
    const reservation = reservationById.get(idOf(relation, ['ReservaId', 'Reserva']))
    if (equipmentId && reservation) reservationsByEquipment.set(equipmentId, { reservation, relation })
  }

  const rows = Equipos.length ? Equipos : ReservaEquipos
  const normalized = rows.map((row, index) => {
    const equipmentId = idOf(row, ['EquipoId', 'ReservaEquipoId', 'Id']) || `equipo-${index + 1}`
    const relation = reservationsByEquipment.get(equipmentId)
    const setId = idOf(row, ['SetId', 'Set', 'GrupoSetId', 'GrupoSet'])
    const set = setById.get(setId)
    const group = groupById.get(idOf(set || row, ['GrupoSetId', 'GrupoId']))
    const setName = text(getValue(set || row, ['Nombre', 'Name', 'Set'])) || text(getValue(group || row, ['Nombre', 'Name', 'GrupoSet']))
    const reservation = relation?.reservation
    const userId = idOf(reservation, ['UsuarioId', 'SolicitanteId', 'AprobadoPorId'])
    const roomId = idOf(reservation, ['SalonId', 'SalonEntrega'])
    const user = userById.get(userId)
    const room = roomById.get(roomId)
    const reservationStatus = text(getValue(reservation, ['Estado', 'Status']))
    const equipmentCode = text(getValue(row, ['Codigo', 'Nombre', 'Name', 'EquipoId'])) || equipmentId
    return {
      id: equipmentCode,
      name: equipmentCode,
      owner: text(getValue(user || reservation || row, ['Nombre', 'Name', 'Responsable', 'Usuario'])) || text(getValue(room || reservation || row, ['Nombre', 'SalonEntrega', 'Salon'])) || 'Sin asignar',
      status: statusOf(row, reservation),
      detail: reservation ? `${reservationStatus || 'Reserva activa'}${text(getValue(room || reservation, ['Nombre', 'SalonEntrega', 'Salon'])) ? ` · ${text(getValue(room || reservation, ['Nombre', 'SalonEntrega', 'Salon']))}` : ''}` : text(getValue(row, ['Detalle', 'Descripcion', 'Descripción'])) || 'Disponible',
      setName: setName || text(getValue(row, ['Set', 'Grupo', 'GrupoSet'])) || 'Sin set',
    }
  })

  const setNames = ['Set A', 'Set B', 'Set C']
  return setNames.map((name, index) => ({
    id: `set-${String.fromCharCode(97 + index)}`,
    label: name,
    description: 'Equipos sincronizados desde AppSheet',
    accent: ['blue', 'orange', 'violet'][index],
    items: normalized.filter((item) => item.setName.toLowerCase() === name.toLowerCase() || item.setName.toLowerCase().includes(name.toLowerCase())),
  }))
}

const buildTodayReservations = ({ Reservas = [], Sets = [], Usuarios = [] }) => {
  const setById = new Map(Sets.map((row) => [idOf(row, ['SetId', 'Id']), row]))
  const userById = new Map(Usuarios.map((row) => [idOf(row, ['UsuarioId', 'Id']), row]))
  const today = todayKey()

  return Reservas
    .filter((reservation) => dateKey(getValue(reservation, ['Fecha', 'Date'])) === today)
    .filter((reservation) => !text(getValue(reservation, ['Estado', 'Status'])).toLowerCase().includes('cancel'))
    .map((reservation) => {
      const set = setById.get(idOf(reservation, ['SetId', 'Set']))
      const user = userById.get(idOf(reservation, ['SolicitanteId', 'UsuarioId', 'Usuario']))
      const status = text(getValue(reservation, ['Estado', 'Status'])) || 'PENDIENTE'
      const requester = text(getValue(user, ['Nombre', 'Name'])) || 'Solicitante sin nombre'
      const setName = text(getValue(set, ['Nombre', 'Name'])) || idOf(reservation, ['SetId', 'Set']) || 'Set sin asignar'
      return {
        id: idOf(reservation, ['ReservaId', 'Id']),
        setId: idOf(reservation, ['SetId', 'Set']),
        start: timeValue(getValue(reservation, ['HoraInicio', 'Inicio'])),
        end: timeValue(getValue(reservation, ['HoraFin', 'Fin'])),
        title: `${status.toLowerCase() === 'pendiente' ? 'Bloqueado' : status} por ${requester}`,
        requester,
        set: setName,
        status,
        quantity: text(getValue(reservation, ['Cantidad', 'Quantity'])) || '0',
        room: text(getValue(reservation, ['SalonEntrega', 'Salon', 'Sala'])) || 'Sin salón',
      }
    })
    .sort((left, right) => `${left.start}${left.id}`.localeCompare(`${right.start}${right.id}`))
}

const buildReservationBoards = ({ Reservas = [], Sets = [], Usuarios = [] }) => {
  const reservations = buildTodayReservations({ Reservas, Sets, Usuarios })
  return Sets.map((set, index) => {
    const code = idOf(set, ['SetId', 'Id'])
    return {
    id: `set-${String.fromCharCode(97 + index)}`,
    label: code.toUpperCase().startsWith('SET-') ? `Set ${code.slice(4)}` : `Set ${String.fromCharCode(65 + index)}`,
    description: text(getValue(set, ['Nombre', 'Name'])) || 'Set de equipos',
    accent: ['blue', 'orange', 'violet'][index % 3],
    reservations: reservations.filter((reservation) => sameId(reservation.setId, code)),
    }
  })
}

const sendJson = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(body))
}

const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' })
const server = createHttpServer(async (request, response) => {
  if (request.url === '/api/boards' && request.method === 'GET') {
    try {
      const result = Object.fromEntries(await Promise.all(appSheetTables.map(async (table) => [table, await readTable(table)])))
      sendJson(response, 200, { boards: buildReservationBoards(result), reservations: buildTodayReservations(result), date: todayKey(), source: 'appsheet', tables: Object.fromEntries(Object.entries(result).map(([table, rows]) => [table, rows.length])) })
    } catch (error) {
      sendJson(response, 502, { message: error.message })
    }
    return
  }

  vite.middlewares(request, response, (error) => {
    if (error) sendJson(response, 500, { message: error.message })
  })
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && !server.fallbackPort) {
    server.fallbackPort = port + 1
    server.listen(server.fallbackPort, () => console.log(`El puerto ${port} estaba ocupado. Servidor listo en http://localhost:${server.fallbackPort}`))
    return
  }
  throw error
})

server.listen(port, () => console.log(`Servidor listo en http://localhost:${port}`))
