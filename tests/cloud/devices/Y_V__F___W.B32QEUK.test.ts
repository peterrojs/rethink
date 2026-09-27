import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import DUT, { buildF026Start, COURSES, loadSavedArmedConfiguration } from '@/cloud/devices/Y_V__F___W.B32QEUK'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq2Device, buf, hex } from '@/tests/helpers/mocks'

const DEVICE_ID = 'test-id'
const MODEL_ID = 'Y_V__F___W.B32QEUK'
const META: Metadata = { modelId: MODEL_ID, modelName: MODEL_ID, swVersion: '0.0.0' }

// Exact Ready frames captured from Joe, except the compact Quick 14 sample,
// which uses the same observed status block and fields.
const SAMPLE_QUICK_14_ARMED = buf(
    'AAFF200A0039000398000100EB0027000001000E000E0C0003020201000000014220000101001100710000010000000000000000000056D9BB',
)
const SAMPLE_DELICATE_ARMED = buf(
    'AAFF200A00600088A7000100EC004E000001002D002D200003050201000000000200000100002B004600000300000000000000000000000001002D002D200003050201000000004200000100002B004600000300000000000000000000BCAABB',
)
const SAMPLE_COTTON_RINSE_PLUS_ARMED = buf(
    'AAFF200A0060008943000100EC004E000001041004100100030A0402000000000200000300002B004600000500000000000000000000000001041004100100030A0402000000004200000300002B004600000500000000000000000000D77DBB',
)
const SAMPLE_WASH_DRY_ARMED = buf(
    'AAFF200A006000896D000100EC004E000001040A040A1300030A0301020000000200000400002B004600000400000000000000004000000001040A040A1300030A0301020000004200000400002B0046000004000000000000000000004DE5BB',
)
const SAMPLE_AI_WASH_ARMED = buf(
    'AAFF200A0060008C20000100EC004E000001003500353A0003020101000000004201000100002B004600000400000000000000000000000001003500353A0003020101000000004201000100002B004600000400000000000000008000EC16BB',
)
const SAMPLE_HAND_WOOL_ARMED = buf(
    'AAFF200A0060008CC6000100EC004E000001001A001A1B0003010101000000004200000100002B004600000300000000000000000000000001001A001A1B0003010101000000004200000100002B004600000300000000000000004000E2EABB',
)
const SAMPLE_MIXED_FABRIC_ARMED = buf(
    'AAFF200A0060008D1B000100EC004E00000100330033070003010101000000004200000100002B00460000030000000000000000400000000100330033070003010101000000004200000100002B0046000003000000000000000000003F6ABB',
)
const SAMPLE_ALLERGY_CARE_ARMED = buf(
    'AAFF200A0060008DF8000100EC004E000001023002302D00030A0601000000804200000400002B00460000050000000000000000C000000001023002302D00030A0601000000804200000400002B00460000050000000000000000000065A3BB',
)
const SAMPLE_EASY_CARE_ARMED = buf(
    'AAFF200A0060008E3C000100EC004E000001023B023B0200030A0401000000004200000300002B004600000300000000000000004000000001023B023B0200030A0401000000004200000300002B0046000003000000000000000000002029BB',
)
const SAMPLE_TURBOWASH_39_ARMED = buf(
    'AAFF200A0060009039000100EC004E00000100270027310003090401000000014200000200002B00460000010000000000000000400000000100270027310003090401000000014200000200002B004600000100000000000000000000F966BB',
)
const SAMPLE_ECO_40_60_ARMED = buf(
    'AAFF200A0060009078000100EC004E000001031C031C0400030A0401000000004200000300002B004600000200000000000000004000000001031C031C0400030A0401000000004200000300002B004600000200000000000000000000138ABB',
)
const SAMPLE_DRY_ONLY_ARMED = buf(
    'AAFF200A0060009103000100EC004E00000100370037180000000000020000004200000600002B00460000000000000000000000400000000100370037180000000000020000004200000600002B004600000000000000000000000000BEF2BB',
)
const SAMPLE_TUB_CLEAN_ARMED = buf(
    'AAFF200A006000913E000100EC004E000001010C010C120003010601000000004200000300002B004600000200000000000000000000000001010C010C120003010601000000004200000300002B0046000002000000000000000040004853BB',
)
const SAMPLE_OFF = buf(
    'AAFF200A0039000487000100EB00270000000000000E0C000000000000000000000000000A0011007100000100002900000000000000CB19BB',
)

function makeDevice() {
    const ha = new MockHAConnection()
    const thinq = new MockThinq2Device(DEVICE_ID, META)
    const dev = new DUT(ha.asConnection(), thinq, META)
    return { ha, thinq, dev }
}

describe(MODEL_ID, () => {
    test('exposes only a start-current-configuration button', () => {
        const { ha } = makeDevice()
        const components = ha.devices[DEVICE_ID].config!.components as Record<string, Record<string, unknown>>
        assert.equal(components.start_configured_program.platform, 'button')
        assert.equal(components.start_configured_program.command_topic, '$this/start_configured_program/set')
    })

    test('builds the verified Quick 14 command, including option byte 11', () => {
        assert.equal(
            buildF026Start({ course: 0x0c, spin: 2, temp: 2, rinse: 1, drying: 0, option11: 1 }).toString('hex'),
            'f0260c030202010000000001030000000000',
        )
    })

    test('requests current status when the device connects', () => {
        const { thinq, dev } = makeDevice()
        dev.start()
        assert.equal(hex(thinq.outbox[0]), 'AA0EF0ED1121010000001800B5BB')
    })

    test('queries fresh status, then starts Quick 14 with the exact captured F026 packet', () => {
        const { thinq, dev } = makeDevice()
        dev.setProperty('start_configured_program', '')
        assert.equal(hex(thinq.outbox[0]), 'AA0EF0ED1121010000001800B5BB')
        thinq.emit('data', SAMPLE_QUICK_14_ARMED)
        assert.equal(hex(thinq.outbox[1]), 'AA16F0260C030202010000000001030000000000BBBB')
    })

    test('labels and starts Delicates with the exact captured F026 packet', () => {
        assert.equal(COURSES[0x20], 'Delicates')
        const { thinq, dev } = makeDevice()
        dev.setProperty('start_configured_program', '')
        thinq.emit('data', SAMPLE_DELICATE_ARMED)
        assert.equal(hex(thinq.outbox[1]), 'AA16F0262003050201000000000003000000000051BB')
    })

    test('starts Cotton Rinse+ with the exact captured F026 packet', () => {
        const { thinq, dev } = makeDevice()
        dev.setProperty('start_configured_program', '')
        thinq.emit('data', SAMPLE_COTTON_RINSE_PLUS_ARMED)
        assert.equal(hex(thinq.outbox[1]), 'AA16F02601030A04020000000000030000000000B8BB')
    })

    test('starts Wash + Dry with the exact captured F026 packet', () => {
        const { thinq, dev } = makeDevice()
        dev.setProperty('start_configured_program', '')
        thinq.emit('data', SAMPLE_WASH_DRY_ARMED)
        assert.equal(hex(thinq.outbox[1]), 'AA16F02613030A03010200000000030000000000AABB')
    })

    test('labels and starts AI Wash with the exact captured F026 packet', () => {
        assert.equal(COURSES[0x3a], 'AI Wash')
        const { thinq, dev } = makeDevice()
        dev.setProperty('start_configured_program', '')
        thinq.emit('data', SAMPLE_AI_WASH_ARMED)
        assert.equal(hex(thinq.outbox[1]), 'AA16F0263A0302010100000000000300000000004FBB')
    })

    test('labels and starts Hand/Wool with the exact captured F026 packet', () => {
        assert.equal(COURSES[0x1b], 'Hand/Wool')
        const { thinq, dev } = makeDevice()
        dev.setProperty('start_configured_program', '')
        thinq.emit('data', SAMPLE_HAND_WOOL_ARMED)
        assert.equal(hex(thinq.outbox[1]), 'AA16F0261B030101010000000000030000000000AFBB')
    })

    test('labels and starts Mixed Fabric with the exact captured F026 packet', () => {
        assert.equal(COURSES[0x07], 'Mixed Fabric')
        const { thinq, dev } = makeDevice()
        dev.setProperty('start_configured_program', '')
        thinq.emit('data', SAMPLE_MIXED_FABRIC_ARMED)
        assert.equal(hex(thinq.outbox[1]), 'AA16F02607030101010000000000030000000000B3BB')
    })

    test('labels and starts Allergy Care with the exact captured F026 packet', () => {
        assert.equal(COURSES[0x2d], 'Allergy Care')
        const { thinq, dev } = makeDevice()
        dev.setProperty('start_configured_program', '')
        thinq.emit('data', SAMPLE_ALLERGY_CARE_ARMED)
        assert.equal(hex(thinq.outbox[1]), 'AA16F0262D030A06010000000080030000000000CFBB')
    })

    test('labels and starts Easy Care with the exact captured F026 packet', () => {
        assert.equal(COURSES[0x02], 'Easy Care')
        const { thinq, dev } = makeDevice()
        dev.setProperty('start_configured_program', '')
        thinq.emit('data', SAMPLE_EASY_CARE_ARMED)
        assert.equal(hex(thinq.outbox[1]), 'AA16F02602030A04010000000000030000000000B8BB')
    })

    test('labels and starts TurboWash 39 with the exact captured F026 packet', () => {
        assert.equal(COURSES[0x31], 'TurboWash 39')
        const { thinq, dev } = makeDevice()
        dev.setProperty('start_configured_program', '')
        thinq.emit('data', SAMPLE_TURBOWASH_39_ARMED)
        assert.equal(hex(thinq.outbox[1]), 'AA16F0263103090401000000000103000000000049BB')
    })

    test('labels and starts Eco 40-60 with the exact captured F026 packet', () => {
        assert.equal(COURSES[0x04], 'Eco 40-60')
        const { thinq, dev } = makeDevice()
        dev.setProperty('start_configured_program', '')
        thinq.emit('data', SAMPLE_ECO_40_60_ARMED)
        assert.equal(hex(thinq.outbox[1]), 'AA16F02604030A04010000000000030000000000BABB')
    })

    test('labels and starts Dry Only with the exact captured F026 packet', () => {
        assert.equal(COURSES[0x18], 'Dry Only')
        const { thinq, dev } = makeDevice()
        dev.setProperty('start_configured_program', '')
        thinq.emit('data', SAMPLE_DRY_ONLY_ARMED)
        assert.equal(hex(thinq.outbox[1]), 'AA16F02618000000000200000000030000000000A6BB')
    })

    test('labels and starts Tub Clean with the exact captured F026 packet', () => {
        assert.equal(COURSES[0x12], 'Tub Clean')
        const { thinq, dev } = makeDevice()
        dev.setProperty('start_configured_program', '')
        thinq.emit('data', SAMPLE_TUB_CLEAN_ARMED)
        assert.equal(hex(thinq.outbox[1]), 'AA16F02612030106010000000000030000000000A3BB')
    })

    test('persists the last armed configuration and an Off frame does not overwrite it', () => {
        const stateDir = mkdtempSync(join(tmpdir(), 'rethink-joe-state-'))
        const previousStateDir = process.env.RETHINK_STATE_DIR
        process.env.RETHINK_STATE_DIR = stateDir

        try {
            const { ha, thinq } = makeDevice()
            thinq.emit('data', SAMPLE_TUB_CLEAN_ARMED)

            const stateFile = join(stateDir, `${DEVICE_ID}-last-armed-configuration.json`)
            const armedFile = readFileSync(stateFile, 'utf-8')
            const saved = loadSavedArmedConfiguration(stateFile)
            assert.deepEqual(
                saved && {
                    version: saved.version,
                    deviceId: saved.deviceId,
                    courseName: saved.courseName,
                    course: saved.course,
                    spin: saved.spin,
                    temp: saved.temp,
                    rinse: saved.rinse,
                    drying: saved.drying,
                    option11: saved.option11,
                    startCommandHex: saved.startCommandHex,
                },
                {
                    version: 1,
                    deviceId: DEVICE_ID,
                    courseName: 'Tub Clean',
                    course: 0x12,
                    spin: 1,
                    temp: 6,
                    rinse: 1,
                    drying: 0,
                    option11: 0,
                    startCommandHex: 'F02612030106010000000000030000000000',
                },
            )
            assert.match(saved!.capturedAt, /^\d{4}-\d{2}-\d{2}T/)
            assert.equal(ha.devices[DEVICE_ID].properties.last_armed_course, 'Tub Clean')

            thinq.emit('data', SAMPLE_OFF)
            assert.equal(readFileSync(stateFile, 'utf-8'), armedFile)

            const restored = makeDevice()
            assert.equal(restored.ha.devices[DEVICE_ID].properties.last_armed_course, 'Tub Clean')
            assert.equal(restored.ha.devices[DEVICE_ID].properties.last_armed_at, saved!.capturedAt)
        } finally {
            if (previousStateDir === undefined) delete process.env.RETHINK_STATE_DIR
            else process.env.RETHINK_STATE_DIR = previousStateDir
            rmSync(stateDir, { recursive: true, force: true })
        }
    })

    test('consumes an armed start packet after one press', () => {
        const { thinq, dev } = makeDevice()
        dev.setProperty('start_configured_program', '')
        thinq.emit('data', SAMPLE_DELICATE_ARMED)
        thinq.emit('data', SAMPLE_DELICATE_ARMED)
        assert.equal(thinq.outbox.length, 2)
    })

    test('never starts from an off status frame', () => {
        const { thinq, dev } = makeDevice()
        dev.setProperty('start_configured_program', '')
        thinq.emit('data', SAMPLE_OFF)
        assert.equal(thinq.outbox.length, 1)
        assert.equal(hex(thinq.outbox[0]), 'AA0EF0ED1121010000001800B5BB')
    })
})
