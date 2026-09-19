import { GreetingHeader } from '@/components/greeting-header';
import { CollectionState, PlantList } from '@/components/plant-list';
import { PlantOverviewCard } from '@/components/plant-overview-card';
import { Screen, ui } from '@/components/screen';
import { useAppData } from '@/context/app-data';
import { useSpaces } from '@/context/spaces';
import { StyleSheet, Text, View } from 'react-native';
export default function Home() { const data = useAppData(); const { spaces } = useSpaces(); return <View style={{ flex: 1 }}><Screen refresh={() => void data.refresh()} loading={data.loading}><View style={s.topBackground} /><GreetingHeader /><View style={ui.card}><Text style={ui.heading}>Your growing world</Text><Text style={ui.text}>{data.loaded ? `${data.plants.length} plants across ${spaces.length} locations.` : 'Your API collection will appear here.'} Health labels reflect backend records, not a calculated health score.</Text></View><CollectionState />{data.loaded && <PlantOverviewCard />}<Text style={ui.heading}>My plants</Text><PlantList plants={data.plants} /></Screen></View>; }
const s = StyleSheet.create({ topBackground: { position: 'absolute', top: 0, width: 476, height: 263, left: '50%', marginLeft: -238, backgroundColor: '#2F8135', borderBottomLeftRadius: 112, borderBottomRightRadius: 112 } });
