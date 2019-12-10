import { LightningElement, api, track } from 'lwc';

export default class Byoo extends LightningElement {
  @api template;

  @track sandboxURL;
  @track regularURL;

  async connectedCallback() {
    console.log(' in connectedCallback');
    const authURL = `/authURL?template=${this.template}`;
    this.regularURL = await (await fetch(authURL)).text();
    this.sandboxURL = await (await fetch(`${authURL}&base_url=https://test.salesforce.com`)).text();
  }
}
