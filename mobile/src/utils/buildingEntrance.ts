import entrances from '@/src/data/buildingEntrances.json';

interface BuildingEntrance {
  building_id: string;
  name: string;
  entrance_lat: number;
  entrance_lng: number;
  entrance_desc: string;
}

export function getEntranceCoords(buildingId: string): { lat: number; lng: number; desc: string } | null {
  const e = (entrances as BuildingEntrance[]).find(b => b.building_id === buildingId);
  if (!e) return null;
  return { lat: e.entrance_lat, lng: e.entrance_lng, desc: e.entrance_desc };
}
