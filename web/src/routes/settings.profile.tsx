import { createFileRoute } from '@tanstack/react-router';
import { CompanySection, ProfileSection } from '../components/settings/ProfileForms';
import { SettingsData } from '../components/settings/parts';

/** Profilo e azienda (J1): le due card con le ancore `#profilo` e `#azienda`. */
export const Route = createFileRoute('/settings/profile')({ component: ProfilePage });

function ProfilePage() {
  return (
    <SettingsData>
      {(settings) => (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <ProfileSection settings={settings} />
          <CompanySection settings={settings} />
        </div>
      )}
    </SettingsData>
  );
}
