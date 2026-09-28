"use client";

import styles from "./confirmed-search.module.css";

export function ConfirmedSearch({ value, onChange, onSearch, label = "Pesquisa", placeholder, className = "" }: {
  value: string;
  onChange: (value: string) => void;
  onSearch: (value: string) => void;
  label?: string;
  placeholder: string;
  className?: string;
}) {
  return <form className={`flow-filter ${styles.search} ${className}`} role="search" onSubmit={event => { event.preventDefault(); onSearch(value.trim()); }}>
    <label className={styles.field}><span>{label}</span><input type="search" value={value} placeholder={placeholder} autoComplete="off" onChange={event => onChange(event.target.value)} /></label>
    <button className="primary-btn" type="submit">Pesquisar</button>
  </form>;
}
