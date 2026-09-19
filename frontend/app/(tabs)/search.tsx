import { CollectionState, PlantList } from '@/components/plant-list';
import { Notice, Screen, ui } from '@/components/screen';
import { useAppData } from '@/context/app-data';
import { useState } from 'react';
import { TextInput } from 'react-native';
export default function Search() { const [query, setQuery] = useState(''); const data = useAppData(); const matches = data.plants.filter(p => [p.name, p.species, p.location ?? ''].join(' ').toLowerCase().includes(query.trim().toLowerCase())); return <Screen title="Find your plants" refresh={() => void data.refresh()} loading={data.loading}><TextInput accessibilityLabel="Search plants by name, species or location" style={ui.input} value={query} onChangeText={setQuery} placeholder="Name, species or location" /><CollectionState /><PlantList plants={matches} />{data.loaded && !matches.length && !!data.plants.length && <Notice>No matching plants.</Notice>}</Screen>; }
