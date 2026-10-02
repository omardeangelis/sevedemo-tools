import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { GenerateCard } from '../components/settings/GenerateCard';
import { CompanySection, ProfileSection } from '../components/settings/ProfileForms';
import { ProposalSection } from '../components/settings/ProposalSection';
import { ServicesCard } from '../components/settings/ServicesCard';
import { ProfileData } from '../components/settings/parts';

/**
 * Profilo e azienda (J1, own-profile-services G1): una colonna nell'ordine del FLOW — la generazione (`#genera`), la
 * proposta in attesa (`#proposta`, sopra le card che modificherebbe), gli indirizzi pubblici (`#profilo`), la mia
 * azienda (`#azienda`), i miei servizi (`#servizi`) — da una lettura sola (B7). Il dialog della generazione lo apre la
 * sua card e la card vuota dei servizi.
 */
export const Route = createFileRoute('/settings/profile')({ component: ProfilePage });

function ProfilePage() {
  const [generating, setGenerating] = useState(false);
  return (
    <ProfileData>
      {(profile) => (
        <div className="flex max-w-4xl flex-col gap-6">
          <GenerateCard profile={profile} open={generating} onOpenChange={setGenerating} />
          <ProposalSection profile={profile} />
          <ProfileSection profile={profile} />
          <CompanySection profile={profile} />
          <ServicesCard services={profile.services} onGenerate={() => setGenerating(true)} />
        </div>
      )}
    </ProfileData>
  );
}
