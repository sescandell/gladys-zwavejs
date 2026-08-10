import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk'

import { BUTTON_STATUS } from '../stateValues.ts'
import type { CommandClassModule } from './types.ts'

/**
 * Central Scene (0x5B) — scene controllers and wall switches.
 *
 * One feature per scene (the property key `001`, `002`... is what
 * distinguishes the buttons), and the only EVENT feature of the integration:
 * pressing the same button twice sends the same value twice, and that
 * repetition IS the information, so these states are never deduplicated.
 */
export const centralScene: CommandClassModule = {
  id: 91,
  name: 'central_scene',
  properties: {
    scene: {
      self: {
        expose: [
          {
            name: '',
            event: true,
            spec: {
              category: DEVICE_FEATURE_CATEGORIES.BUTTON,
              type: DEVICE_FEATURE_TYPES.BUTTON.CLICK,
              min: 0,
              max: 4,
              read_only: true,
              has_feedback: true,
              keep_history: false,
            },
          },
        ],
        fromZwave: [
          {
            convert: (raw) => {
              switch (raw) {
                case 0:
                  return BUTTON_STATUS.CLICK
                case 1:
                  return BUTTON_STATUS.RELEASE
                case 2:
                  return BUTTON_STATUS.HOLD_CLICK
                case 3:
                  return BUTTON_STATUS.DOUBLE_CLICK
                case 4:
                  return BUTTON_STATUS.TRIPLE
                default:
                  return null
              }
            },
          },
        ],
      },
    },
  },
}
