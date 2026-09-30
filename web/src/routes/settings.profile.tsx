import { createFileRoute } from '@tanstack/react-router';
import { CompanySection, ProfileSection } from '../components/settings/ProfileForms';
import { ServicesCard } from '../components/settings/ServicesCard';
import { ProfileData } from '../components/settings/parts';

/**
 * Profilo e azienda (J1, own-profile-services G1): una colonna nell'ordine del FLOW — indirizzi pubblici
 * (`#profilo`), la mia azienda (`#azienda`), i miei servizi (`#servizi`) — da una lettura sola (B7). Le card
 * della generazione e della proposta arrivano con M4.
 */
export const Route = createFileRoute('/settings/profile')({ component: ProfilePage });

function ProfilePage() {
  return (
    <ProfileData>
      {(profile) => (
        <div className="flex max-w-4xl flex-col gap-6">
          <ProfileSection profile={profile} />
          <CompanySection profile={profile} />
          <ServicesCard services={profile.services} />
        </div>
      )}
    </ProfileData>
  );
}
