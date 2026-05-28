import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateMySettingsDto } from './update-my-settings.dto';

describe('UpdateMySettingsDto', () => {
  it('accepts editor.confirmBeforeLeave in settings patch', () => {
    const dto = plainToInstance(UpdateMySettingsDto, {
      settings: {
        editor: {
          contentWidth: 900,
          fontSize: 16,
          confirmBeforeLeave: true,
        },
      },
    });

    const errors = validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(0);
  });
});
