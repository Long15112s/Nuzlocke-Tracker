type PokemonSpriteProps = {
  spriteUrl?: string;
  alt?: string;
  size?: number;
  className?: string;
};

export default function PokemonSprite({ spriteUrl, alt = "Pokémon", size = 40, className = "" }: PokemonSpriteProps) {
  if (!spriteUrl) {
    return (
      <div
        className={`pokemonSprite placeholder ${className}`.trim()}
        style={{ width: size, height: size, minWidth: size, minHeight: size }}
        aria-label={`${alt} placeholder`}
        title={alt}
      >
        ?
      </div>
    );
  }

  return (
    <img
      src={spriteUrl}
      alt={alt}
      title={alt}
      className={`pokemonSprite ${className}`.trim()}
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
      loading="lazy"
      onError={(event) => {
        const target = event.currentTarget;
        target.style.display = "none";
      }}
    />
  );
}
