import HADevice from './base'
import { Device as Thinq2Device } from '../thinq2/device'
import { type Connection } from '../homeassistant'
import { type Metadata } from '../thinq'
import { allowExtendedType } from '@/util/casting'
import AABBDevice from './aabb_device'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ERRORS, STATES, COURSES as COMMON_COURSES, TEMPERATURES, SPINS, DRYING_MODES } from './washer_common'

const STATUS_REQUEST = Buffer.from('F0ED1121010000001800', 'hex')
const START_REQUEST_TIMEOUT_MS = 10_000

// Model-specific labels verified on Joe's physical programme selector.
// The shared table calls 0x3A Bedding, but this model exposes it as AI Wash.
export const COURSES: Record<number, string> = {
    ...COMMON_COURSES,
    0x02: 'Easy Care',
    0x07: 'Mixed Fabric',
    0x12: 'Tub Clean',
    0x18: 'Dry Only',
    0x1b: 'Hand/Wool',
    0x20: 'Delicates',
    0x3a: 'AI Wash',
}

// LG washer Y_V__F___W.B32QEUK (ThinQ2 device type 201).
//
// The modem reports the same double-status-frame envelope used by
// Y_V8_F___W.B_2QEUK: an AABB payload beginning 20 0A, with the live state
// in the second block at offset 54. Starting is supported with the F026
// command captured from Joe: all programme and option bytes are copied from a
// fresh, remotely armed Ready status frame.
export interface F026StartConfiguration {
    course: number
    spin: number
    temp: number
    rinse: number
    drying: number
    option11: number
}

export interface SavedArmedConfiguration extends F026StartConfiguration {
    version: 1
    deviceId: string
    capturedAt: string
    courseName: string
    startCommandHex: string
}

function savedConfigurationPath(deviceId: string): string | undefined {
    const stateDir = process.env.RETHINK_STATE_DIR
    if (!stateDir) return undefined

    const safeDeviceId = deviceId.replace(/[^a-zA-Z0-9._-]/g, '_')
    return join(stateDir, `${safeDeviceId}-last-armed-configuration.json`)
}

export function loadSavedArmedConfiguration(path: string): SavedArmedConfiguration | undefined {
    try {
        const value = JSON.parse(readFileSync(path, 'utf-8')) as Partial<SavedArmedConfiguration>
        if (
            value.version === 1 &&
            typeof value.deviceId === 'string' &&
            typeof value.capturedAt === 'string' &&
            typeof value.courseName === 'string' &&
            typeof value.startCommandHex === 'string' &&
            typeof value.course === 'number' &&
            typeof value.spin === 'number' &&
            typeof value.temp === 'number' &&
            typeof value.rinse === 'number' &&
            typeof value.drying === 'number' &&
            typeof value.option11 === 'number'
        )
            return value as SavedArmedConfiguration
    } catch {}
    return undefined
}

function saveArmedConfiguration(path: string, value: SavedArmedConfiguration): void {
    const temporaryPath = `${path}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporaryPath, path)
}

function sameStartConfiguration(left: F026StartConfiguration | undefined, right: F026StartConfiguration): boolean {
    return (
        left?.course === right.course &&
        left.spin === right.spin &&
        left.temp === right.temp &&
        left.rinse === right.rinse &&
        left.drying === right.drying &&
        left.option11 === right.option11
    )
}

export function buildF026Start(config: F026StartConfiguration): Buffer {
    const command = Buffer.alloc(18)
    command[0] = 0xf0
    command[1] = 0x26
    command[2] = config.course
    // Joe's Dry Only course uses command-mode 0x00. Wash programmes,
    // including Wash + Dry, use 0x03.
    command[3] = config.course === 0x18 ? 0x00 : 0x03
    command[4] = config.spin
    command[5] = config.temp
    command[6] = config.rinse
    command[7] = config.drying
    command[11] = config.option11
    command[12] = 0x03
    return command
}

export default class Device extends AABBDevice {
    // A button press first requests fresh status. Only the response to that
    // request may supply the one-shot start packet, so an automation can safely
    // run hours after Remote Start was armed without trusting cached state.
    private armedStartPacket?: Buffer
    private pendingStartUntil = 0

    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        super(HA, thinq)
        this.setConfig(
            allowExtendedType({
                ...HADevice.config(meta, { name: 'LG Washer (local)' }),
                components: {
                    start_configured_program: {
                        platform: 'button',
                        unique_id: '$deviceid-start-configured-program',
                        command_topic: '$this/start_configured_program/set',
                        payload_press: '',
                        name: 'Start configured programme',
                        icon: 'mdi:play-circle-outline',
                    },
                    status: {
                        platform: 'sensor',
                        unique_id: '$deviceid-status',
                        state_topic: '$this/status',
                        name: 'Status',
                        icon: 'mdi:state-machine',
                        device_class: 'enum',
                        options: STATES.filter((a) => a !== undefined),
                    },
                    error: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-error',
                        state_topic: '$this/error',
                        name: 'Error',
                        icon: 'mdi:check-circle',
                        device_class: 'problem',
                        entity_category: 'diagnostic',
                    },
                    error_message: {
                        platform: 'sensor',
                        unique_id: '$deviceid-error-message',
                        state_topic: '$this/error_message',
                        name: 'Error message',
                        icon: 'mdi:alert-circle-outline',
                        device_class: 'enum',
                        entity_category: 'diagnostic',
                        options: ERRORS.filter((a) => a !== undefined),
                    },
                    course: {
                        platform: 'sensor',
                        unique_id: '$deviceid-course',
                        state_topic: '$this/course',
                        name: 'Course',
                        icon: 'mdi:pin-outline',
                    },
                    last_armed_course: {
                        platform: 'sensor',
                        unique_id: '$deviceid-last-armed-course',
                        state_topic: '$this/last_armed_course',
                        name: 'Last armed course',
                        icon: 'mdi:content-save-check-outline',
                        entity_category: 'diagnostic',
                    },
                    last_armed_configuration: {
                        platform: 'sensor',
                        unique_id: '$deviceid-last-armed-configuration',
                        state_topic: '$this/last_armed_configuration',
                        name: 'Last armed configuration',
                        icon: 'mdi:code-json',
                        entity_category: 'diagnostic',
                    },
                    last_armed_at: {
                        platform: 'sensor',
                        unique_id: '$deviceid-last-armed-at',
                        state_topic: '$this/last_armed_at',
                        name: 'Last armed at',
                        icon: 'mdi:clock-check-outline',
                        device_class: 'timestamp',
                        entity_category: 'diagnostic',
                    },
                    temp: {
                        platform: 'sensor',
                        unique_id: '$deviceid-temp',
                        state_topic: '$this/temp',
                        name: 'Temperature',
                        device_class: 'temperature',
                        unit_of_measurement: '°C',
                        suggested_display_precision: 0,
                    },
                    spin: {
                        platform: 'sensor',
                        unique_id: '$deviceid-spin',
                        state_topic: '$this/spin',
                        name: 'Spin',
                        icon: 'mdi:autorenew',
                        unit_of_measurement: 'RPM',
                    },
                    drying_mode: {
                        platform: 'sensor',
                        unique_id: '$deviceid-drying-mode',
                        state_topic: '$this/drying_mode',
                        name: 'Drying mode',
                        icon: 'mdi:tumble-dryer',
                    },
                    cycles: {
                        platform: 'sensor',
                        unique_id: '$deviceid-cycles',
                        state_topic: '$this/cycles',
                        name: 'Cycle count',
                        icon: 'mdi:counter',
                    },
                    remote_start: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-remote_start',
                        state_topic: '$this/remote_start',
                        name: 'Remote start',
                        icon: 'mdi:play-circle-outline',
                    },
                    door_lock: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-door_lock',
                        state_topic: '$this/door_lock',
                        name: 'Door lock',
                        device_class: 'lock',
                    },
                    energy: {
                        platform: 'sensor',
                        unique_id: '$deviceid-energy',
                        state_topic: '$this/energy',
                        name: 'Energy',
                        icon: 'mdi:lightning-bolt',
                        device_class: 'energy',
                        state_class: 'total_increasing',
                        unit_of_measurement: 'Wh',
                    },
                    initial_time: {
                        platform: 'sensor',
                        unique_id: '$deviceid-initial_time',
                        state_topic: '$this/initial_time',
                        device_class: 'duration',
                        unit_of_measurement: 'min',
                        name: 'Initial time',
                    },
                    remaining_time: {
                        platform: 'sensor',
                        unique_id: '$deviceid-remaining_time',
                        state_topic: '$this/remaining_time',
                        device_class: 'duration',
                        unit_of_measurement: 'min',
                        name: 'Remaining time',
                    },
                },
            }),
        )

        this.savedConfigurationFile = savedConfigurationPath(this.id)
        const saved = this.savedConfigurationFile ? loadSavedArmedConfiguration(this.savedConfigurationFile) : undefined
        if (saved) {
            this.lastSavedConfiguration = saved
            this.publishSavedConfiguration(saved)
        }
    }

    private savedConfigurationFile?: string
    private lastSavedConfiguration?: SavedArmedConfiguration
    private wasStartAllowed = false

    private publishSavedConfiguration(saved: SavedArmedConfiguration) {
        this.publishProperty('last_armed_course', saved.courseName)
        this.publishProperty(
            'last_armed_configuration',
            JSON.stringify({
                course: saved.course,
                spin: saved.spin,
                temp: saved.temp,
                rinse: saved.rinse,
                drying: saved.drying,
                option11: saved.option11,
            }),
        )
        this.publishProperty('last_armed_at', saved.capturedAt)
    }

    private rememberArmedConfiguration(config: F026StartConfiguration, packet: Buffer) {
        if (this.wasStartAllowed && sameStartConfiguration(this.lastSavedConfiguration, config)) return

        const saved: SavedArmedConfiguration = {
            version: 1,
            deviceId: this.id,
            capturedAt: new Date().toISOString(),
            courseName: COURSES[config.course] ?? 'unknown',
            ...config,
            startCommandHex: packet.toString('hex').toUpperCase(),
        }
        this.lastSavedConfiguration = saved
        this.publishSavedConfiguration(saved)

        if (this.savedConfigurationFile) {
            try {
                saveArmedConfiguration(this.savedConfigurationFile, saved)
            } catch (err) {
                console.warn(`Could not persist Joe's armed configuration: ${String(err)}`)
            }
        }
    }

    start() {
        this.send(STATUS_REQUEST)
    }

    processAABB(buf: Buffer) {
        // Only these two frame types carry the compatible status block.
        // Completion diagnostics (for example 0x58/0x74) also start with
        // 20 … 01, but have a different layout and must not overwrite the
        // live state with invented timers or status values.
        if (buf[0] !== 0x20 || buf[8] !== 0x01 || (buf[3] !== 0x39 && buf[3] !== 0x60)) return

        // A single status block starts at 15; current status in the observed
        // double block starts at 54. Reject short or unfamiliar layouts.
        const offset = buf.length > 73 ? 54 : 15
        if (buf.length <= offset + 29) return

        const status = buf[offset]
        const remaining = buf[offset + 1] * 60 + buf[offset + 2]
        const initial = buf[offset + 3] * 60 + buf[offset + 4]
        const course = buf[offset + 5]
        const error = buf[offset + 6]
        const spin = buf[offset + 8]
        const temp = buf[offset + 9]
        const rinse = buf[offset + 10]
        const drying = buf[offset + 11]
        const option11 = buf[offset + 14]
        const remoteStart = Boolean(buf[offset + 15] & 0x40)
        const doorLocked = !(buf[offset + 19] & 0x40)

        const startAllowed = status === 1 && course !== 0 && error === 0 && remoteStart && doorLocked
        const startConfiguration = { course, spin, temp, rinse, drying, option11 }
        this.armedStartPacket = startAllowed ? buildF026Start(startConfiguration) : undefined
        if (this.armedStartPacket) this.rememberArmedConfiguration(startConfiguration, this.armedStartPacket)
        this.wasStartAllowed = startAllowed

        if (this.pendingStartUntil) {
            const packet = Date.now() <= this.pendingStartUntil ? this.armedStartPacket : undefined
            this.pendingStartUntil = 0
            this.armedStartPacket = undefined
            if (packet) this.send(packet)
        }

        this.publishProperty('error_message', ERRORS[error] ?? 'unknown')
        this.publishProperty('error', error ? 'ON' : 'OFF')
        this.publishProperty('status', STATES[status] ?? 'unknown')
        this.publishProperty('course', COURSES[course] ?? 'unknown')
        this.publishProperty('spin', SPINS[spin] ?? 'unknown')
        this.publishProperty('temp', TEMPERATURES[temp] ?? 'unknown')
        this.publishProperty('drying_mode', DRYING_MODES[drying] ?? 'unknown')
        this.publishProperty('remote_start', remoteStart ? 'ON' : 'OFF')
        this.publishProperty('door_lock', doorLocked ? 'ON' : 'OFF')
        this.publishProperty('initial_time', initial)
        this.publishProperty('remaining_time', remaining)
        this.publishProperty('energy', buf[offset + 28] * 256 + buf[offset + 29])
    }

    setProperty(prop: string, _mqttValue: string) {
        if (prop === 'start_configured_program') {
            this.armedStartPacket = undefined
            this.pendingStartUntil = Date.now() + START_REQUEST_TIMEOUT_MS
            this.send(STATUS_REQUEST)
        }
    }
}
