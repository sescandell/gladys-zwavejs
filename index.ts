/**
 * Z-Wave JS UI integration for Gladys Assistant.
 *
 * Entry point: SDK bootstrap and callback wiring only — every behaviour lives
 * in `src/runtime/ZwaveIntegration.ts`.
 *
 * The Gladys supervisor injects three environment variables into the
 * container: GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN and
 * GLADYS_INTEGRATION_SELECTOR. The SDK reads them on its own, so
 * `new GladysIntegration()` is all it takes.
 */
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk'

import { ZwaveIntegration } from './src/runtime/ZwaveIntegration.ts'

const gladys = new GladysIntegration()
const integration = new ZwaveIntegration(gladys, logger)

// Handlers must be registered BEFORE connect(): a command arriving without one
// is acked as "not implemented".
gladys.onScanRequest(() => integration.requestScan())
gladys.onSetValue((device, feature, value) => integration.setValue(device, feature, value))
gladys.onConfigUpdated((config) => integration.onConfigUpdated(config))
gladys.onDeviceCreated((device) => integration.onDeviceCreated(device))
gladys.onDeviceUpdated((device) => integration.onDeviceUpdated(device))
gladys.onDeviceDeleted((device) => integration.onDeviceDeleted(device))
gladys.onAction('test_connection', () => integration.testConnection())
gladys.onAction('dump_devices', () => integration.dumpDevices())

// Nothing survives a disconnection (the protocol has no queue): the SDK
// resynchronizes the devices and the configuration, and we redo our own
// initialization on top of that.
gladys.on('connected', () => {
  integration.start().catch((error) => {
    logger.error('Initialization failed', error)
  })
})

gladys.on('disconnected', () => {
  integration.stop().catch((error) => {
    logger.warn('Failed to stop cleanly', error)
  })
})

gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal}, shutting down`)
  await integration.stop()
})

gladys.connect().catch((error) => {
  logger.error('Cannot connect to Gladys', error)
  process.exit(1)
})
