import { CollectionState, PlantList } from '@/components/plant-list';
import { Action, Notice, Screen } from '@/components/screen';
import { useAppData } from '@/context/app-data';
import { useSpaces } from '@/context/spaces';
import { useLocalSearchParams } from 'expo-router';
export default function SpaceDetail() { const { space } = useLocalSearchParams<{ space: string }>(); const { plantsBySpace } = useSpaces(); const data = useAppData(); const plants = plantsBySpace[space] ?? []; return <Screen title={space || 'Location'} back refresh={() => void data.refresh()} loading={data.loading}><CollectionState /><PlantList plants={plants} />{data.loaded && !plants.length && <Notice>No plants at this location.</Notice>}<Action label="Edit / archive location — unavailable" disabled /></Screen>; }
