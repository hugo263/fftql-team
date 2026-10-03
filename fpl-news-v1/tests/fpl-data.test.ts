import test from "node:test";
import assert from "node:assert/strict";
import { priceDifferences,seasonOf,type FplBootstrap } from "../packages/backend/src/fpl/data.ts";
import { identifyPlayerTags,withFplCategory,withFplGameplay } from "../packages/backend/src/fpl/tags.ts";
test("price comparisons ignore newly registered players and retain rises and falls",()=>{
  assert.deepEqual(priceDifferences({"101":75,"102":60},{"101":76,"102":59,"103":45}),[{code:101,oldCost:75,newCost:76},{code:102,oldCost:60,newCost:59}]);
  assert.deepEqual(priceDifferences({}, {"101":76}),[]);
});
test("season identity comes from the opening deadline, not today's year",()=>{
  const data={events:[{deadline_time:"2026-08-14T17:30:00Z"}]} as FplBootstrap;
  assert.equal(seasonOf(data),"2026/27");
});
test("player tags avoid substrings, ambiguous surnames and common words",()=>{
  const players=[{name:"Rice",full_name:"Declan Rice"},{name:"White",full_name:"Ben White"},{name:"Smith",full_name:"Adam Smith"},{name:"Smith",full_name:"John Smith"}];
  assert.deepEqual(identifyPlayerTags("Price changes, a white shirt and Smith",players),[]);
  assert.deepEqual(identifyPlayerTags("Declan Rice and Ben White return; Adam Smith is out",players),["球员:Rice","球员:White","球员:Smith"]);
});
test("the public category and its primary tag agree while retaining other dimensions",()=>{
  assert.deepEqual(withFplCategory(["首发与轮换","Classic","预测","曼城"],"players"),["球员与选人分析","Classic","预测","曼城"]);
});

test("Classic chips do not turn a team draft into the Draft game",()=>{
  assert.deepEqual(withFplGameplay("FPL GW5 Team Selection: wildcard draft",["策略","Draft","通用"]),["策略","Classic"]);
  assert.deepEqual(withFplGameplay("Classic wildcard vs FPL Draft league waivers",["策略","通用"]),["策略","Classic","Draft"]);
  assert.deepEqual(withFplGameplay("Draft league captain of the club",["Draft"]),["Draft"]);
});
