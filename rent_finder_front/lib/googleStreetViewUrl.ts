/**
 * Constrói o URL oficial do Google Maps que abre o **Street View** num par lat/lng.
 *
 * Usa a "Maps URL API" (`api=1` + `map_action=pano`), que é a forma suportada
 * publicamente para deep-linking do Street View independente da plataforma
 * (web, Android, iOS) — ver https://developers.google.com/maps/documentation/urls/get-started#street-view-action
 *
 * Quando o ponto não tiver imagem panorâmica disponível, o Google Maps abre o
 * mapa centrado na coordenada com a camada de Street View ativa (UX fallback
 * tratado pelo próprio Google).
 *
 * Forçamos `pitch=0` (câmara horizontal) deliberadamente: sem este parâmetro o
 * Google reutiliza a inclinação **nativa** do pano mais próximo — e em panos
 * *indoor* de comércio ou em câmaras com tilt acentuado isso resulta numa imagem
 * apontada para o chão/tecto (o utilizador vê só preto / pavimento). `heading`
 * é deixado de fora para o Google escolher um sentido "inteligente" baseado no
 * `viewpoint` (normalmente da rua a apontar ao edifício).
 *
 * `fov=90` mantém o ângulo padrão; explicitá-lo deixa claro que não estamos a
 * pedir um zoom anormal.
 */
export function googleStreetViewUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}&pitch=0&fov=90`;
}
