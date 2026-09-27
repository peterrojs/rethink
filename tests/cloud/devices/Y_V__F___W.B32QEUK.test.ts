import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import DUT, { buildF026Start, COURSES } from '@/cloud/devices/Y_V__F___W.B32QEUK'
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
