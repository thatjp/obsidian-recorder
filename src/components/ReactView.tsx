import { useApp } from '../hooks/useAppContext';

export const ReactView = () => {
  const { vault } = useApp();

  return <h4>{vault.getName()} things</h4>;
};