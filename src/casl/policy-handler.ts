import { AppAbility } from './casl-ability.factory';

interface PolicyHandlerObject {
  handle(ability: AppAbility): boolean;
}

type PolicyHandlerCallback = (ability: AppAbility) => boolean;

export type PolicyHandler = PolicyHandlerObject | PolicyHandlerCallback;
